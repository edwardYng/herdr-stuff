import { describe, expect, it } from "vitest";
import { UA } from "../../../src/data/http.js";
import { createYahooSession } from "../../../src/data/yahoo-session.js";
import { fakeCurl, fcHeaders, fixtureText, memoryStorage } from "./fakes.js";

const FC = "https://fc.yahoo.com";
const CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const API = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price";
const A3 = "A3=d=AQABBFAKE&S=AQAAAFAKE";

/** A Yahoo that hands out cookie/crumb and answers the API with `api` (by call). */
function yahoo({
  crumb = "abc/DEF.12",
  api = () => ({ body: '{"ok":1}' }),
  fc = () => ({ status: 404, headers: fcHeaders(), body: "<html>sad panda</html>" }),
} = {}) {
  let n = 0;
  return fakeCurl([
    [(u) => u === FC, fc],
    [(u) => u === CRUMB_URL, () => (typeof crumb === "string" ? { body: crumb } : crumb)],
    [(u) => u.startsWith(API), (u) => api(u, n++)],
  ]);
}

const apiCalls = (exec) => exec.calls.filter((c) => c.args.at(-1).startsWith(API));

describe("yahoo session", () => {
  it("gets the A3 cookie, then the crumb, then the URL with both; curl args as before", async () => {
    const exec = yahoo();
    const storage = memoryStorage();
    const s = createYahooSession({ exec, platform: "linux", storage });
    expect(await s.get(API)).toEqual({ status: 200, body: '{"ok":1}' });

    const base = ["-s", "--compressed", "--max-time", "12", "-A", UA, "-w", "\n%{http_code}"];
    expect(exec.calls.map((c) => [c.command, ...c.args])).toEqual([
      ["curl", ...base, "-i", FC],
      ["curl", ...base, "-H", `Cookie: ${A3}`, CRUMB_URL],
      ["curl", ...base, "-H", `Cookie: ${A3}`, `${API}&crumb=abc%2FDEF.12`],
    ]);
  });

  it("parses the cookie out of a real fc.yahoo.com header dump", async () => {
    const exec = yahoo({ fc: () => ({ stdout: fixtureText("yahoo/session/fc-yahoo-curl-stdout.txt") }) });
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    await s.get(API);
    expect(s.current()).toEqual({ cookie: "A3=d=AQABBFAKEFAKE&S=AQAAAFAKEFAKE", crumb: "abc/DEF.12" });
  });

  it("uses ? for a URL without a query", async () => {
    const plain = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL";
    const exec = fakeCurl([
      [(u) => u === FC, { status: 404, headers: fcHeaders() }],
      [(u) => u === CRUMB_URL, { body: "c1" }],
      [(u) => u.startsWith(plain), { body: "{}" }],
    ]);
    await createYahooSession({ exec, platform: "linux", storage: null }).get(plain);
    expect(exec.calls.at(-1).args.at(-1)).toBe(`${plain}?crumb=c1`);
  });

  it.each([
    ["win32", "curl.exe"],
    ["windows", "curl.exe"],
    ["darwin", "curl"],
    ["linux", "curl"],
  ])("runs curl as %s → %s", async (platform, bin) => {
    const exec = yahoo();
    await createYahooSession({ exec, platform, storage: memoryStorage() }).get(API);
    expect(new Set(exec.calls.map((c) => c.command))).toEqual(new Set([bin]));
  });

  it("persists {cookie, crumb} under 'yahoo' and reuses it without asking again", async () => {
    const storage = memoryStorage();
    const exec = yahoo();
    await createYahooSession({ exec, platform: "linux", storage }).get(API);
    expect(JSON.parse(storage.data.get("yahoo"))).toEqual({ cookie: A3, crumb: "abc/DEF.12" });

    // a new session (Herdr restarted) reads storage instead of curling fc.yahoo.com
    const exec2 = yahoo();
    const s2 = createYahooSession({ exec: exec2, platform: "linux", storage });
    await s2.get(API);
    await s2.get(API);
    expect(exec2.calls.map((c) => c.args.at(-1))).toEqual([`${API}&crumb=abc%2FDEF.12`, `${API}&crumb=abc%2FDEF.12`]);
  });

  it("reads storage lazily, once", async () => {
    const storage = memoryStorage({ yahoo: JSON.stringify({ cookie: "A3=old", crumb: "oldcrumb" }) });
    const exec = yahoo();
    const s = createYahooSession({ exec, platform: "linux", storage });
    expect(storage.reads).toBe(0);
    await s.get(API);
    await s.get(API);
    expect(storage.reads).toBe(1);
    expect(exec.calls[0].args).toContain("Cookie: A3=old");
    expect(exec.calls[0].args.at(-1)).toBe(`${API}&crumb=oldcrumb`);
  });

  it.each([["not json"], ['{"cookie":1}'], ["null"]])("ignores a stored value %s", async (stored) => {
    const exec = yahoo();
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage({ yahoo: stored }) });
    await s.get(API);
    expect(exec.calls[0].args.at(-1)).toBe(FC);
  });

  it("survives a storage that throws", async () => {
    const storage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("full");
      },
    };
    const exec = yahoo();
    expect((await createYahooSession({ exec, platform: "linux", storage }).get(API)).status).toBe(200);
  });

  it("refreshes a stale stored session on 401, then succeeds and stores the new one", async () => {
    const storage = memoryStorage({ yahoo: JSON.stringify({ cookie: "A3=old", crumb: "old" }) });
    const exec = yahoo({
      api: (u) =>
        u.endsWith("crumb=old") ? { status: 401, fixture: "yahoo/summary/unauthorized.json" } : { body: "{}" },
    });
    const s = createYahooSession({ exec, platform: "linux", storage });
    expect(await s.get(API)).toEqual({ status: 200, body: "{}" });
    expect(exec.calls.map((c) => c.args.at(-1))).toEqual([
      `${API}&crumb=old`,
      FC,
      CRUMB_URL,
      `${API}&crumb=abc%2FDEF.12`,
    ]);
    expect(JSON.parse(storage.data.get("yahoo")).crumb).toBe("abc/DEF.12");
  });

  it("refreshes on 403 too, and gives up after one retry with the last answer", async () => {
    const exec = yahoo({ api: () => ({ status: 403, body: "forbidden" }) });
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    expect(await s.get(API)).toEqual({ status: 403, body: "forbidden" });
    expect(apiCalls(exec)).toHaveLength(2);
    expect(exec.calls.filter((c) => c.args.at(-1) === FC)).toHaveLength(2);
  });

  it("starts only one new session for concurrent requests", async () => {
    const exec = yahoo();
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    await Promise.all([s.get(API), s.get(API), s.get(API)]);
    expect(exec.calls.filter((c) => c.args.at(-1) === FC)).toHaveLength(1);
    expect(apiCalls(exec)).toHaveLength(3);
  });

  it("returns other statuses as they are; status 0 when curl got no answer", async () => {
    const exec = yahoo({ api: (_, n) => (n === 0 ? { status: 404, body: "{}" } : { stdout: "" }) });
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    expect(await s.get(API)).toEqual({ status: 404, body: "{}" });
    expect(await s.get(API)).toEqual({ status: 0, body: "" });
  });

  it("fails with 'no Yahoo cookie' when fc.yahoo.com sets none", async () => {
    const exec = yahoo({ fc: () => ({ status: 404, headers: "HTTP/2 404\r\ncontent-type: text/html\r\n\r\n" }) });
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    await expect(s.get(API)).rejects.toThrow("no Yahoo cookie");
  });

  it.each([
    ["an HTML page", { body: "<html>nope</html>" }],
    ["a JSON error", { body: '{"finance":{"error":{}}}' }],
    ["an empty crumb", { body: "  \n" }],
    ["a non-200", { status: 429, body: "Too Many Requests" }],
  ])("rejects %s as crumb", async (_, crumb) => {
    const storage = memoryStorage();
    const exec = yahoo({ crumb });
    const s = createYahooSession({ exec, platform: "linux", storage });
    await expect(s.get(API)).rejects.toThrow("no Yahoo crumb");
    expect(storage.data.has("yahoo")).toBe(false);
    expect(apiCalls(exec)).toHaveLength(0);
  });

  it("lets exec's error through when curl can't run", async () => {
    const exec = async () => {
      throw new Error("spawn curl ENOENT");
    };
    const s = createYahooSession({ exec, platform: "linux", storage: memoryStorage() });
    await expect(s.get(API)).rejects.toThrow("ENOENT");
  });

  it("current() is null before any session", () => {
    expect(createYahooSession({ exec: yahoo(), platform: "linux" }).current()).toBeNull();
  });
});
