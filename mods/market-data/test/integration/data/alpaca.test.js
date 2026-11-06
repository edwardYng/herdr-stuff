import { describe, expect, it } from "vitest";
import { ALPACA_STREAM, createAlpaca, readAlpacaKeys } from "../../../src/data/alpaca.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeFetch, fixture } from "./fakes.js";

const KEYS = { key: "test-key-id", secret: "test-secret" };
const NOW = Date.parse("2026-11-05T21:00:00Z");

const routes = () => [
  ["/v2/stocks/AAPL/snapshot", { fixture: "alpaca/snapshot-AAPL.json" }],
  ["/v2/stocks/AAPL/bars", { fixture: "alpaca/bars-AAPL.json" }],
  ["/v2/stocks/snapshots", { fixture: "alpaca/snapshots-AAPL-MSFT-BRK.B.json" }],
];

describe("alpaca.history", () => {
  it("returns the snapshot's latest trade, previous close and the bars oldest-first", async () => {
    const fetch = fakeFetch(routes());
    const h = await createAlpaca({ fetch, now: () => NOW }).history("AAPL", KEYS);
    const snap = fixture("alpaca/snapshot-AAPL.json");
    const bars = fixture("alpaca/bars-AAPL.json").bars;
    expect(h.price).toBe(snap.latestTrade.p);
    expect(h.ref).toBe(snap.prevDailyBar.c);
    expect(h.spark).toHaveLength(78);
    expect(h.spark[0]).toBe(bars.at(-1).c);
    expect(h.spark.at(-1)).toBe(bars[0].c);
  });

  it("asks for the snapshot and 78 five-minute bars from 5 days back, with the key headers", async () => {
    const fetch = fakeFetch(routes());
    await createAlpaca({ fetch, now: () => NOW }).history("AAPL", KEYS);
    const urls = fetch.calls.map((c) => c.url);
    expect(urls).toEqual([
      "https://data.alpaca.markets/v2/stocks/AAPL/snapshot?feed=iex",
      "https://data.alpaca.markets/v2/stocks/AAPL/bars?timeframe=5Min&feed=iex&sort=desc&limit=78&start=2026-10-31T21:00:00.000Z",
    ]);
    for (const c of fetch.calls) {
      expect(c.options.headers).toEqual({ "APCA-API-KEY-ID": "test-key-id", "APCA-API-SECRET-KEY": "test-secret" });
    }
  });

  it("encodes the symbol", async () => {
    const fetch = fakeFetch([[/./, { json: { latestTrade: { p: 1 } } }]]);
    await createAlpaca({ fetch }).history("BRK.B/X", KEYS);
    expect(fetch.calls[0].url).toContain("/v2/stocks/BRK.B%2FX/snapshot");
  });

  it("falls back to the daily bar, then to the last bar for the price", async () => {
    const daily = fakeFetch([
      ["/snapshot", { json: { dailyBar: { c: 5 }, prevDailyBar: { c: 4 } } }],
      ["/bars", { json: { bars: [] } }],
    ]);
    expect(await createAlpaca({ fetch: daily }).history("X", KEYS)).toEqual({ price: 5, ref: 4, spark: [] });

    const barsOnly = fakeFetch([
      ["/snapshot", { json: {} }],
      ["/bars", { json: { bars: [{ c: 3 }, { c: 2 }] } }],
    ]);
    expect(await createAlpaca({ fetch: barsOnly }).history("X", KEYS)).toEqual({
      price: 3,
      ref: undefined,
      spark: [2, 3],
    });
  });

  it("throws no data when nothing has a price", async () => {
    const fetch = fakeFetch([
      ["/snapshot", { json: null }],
      ["/bars", { json: { bars: null } }],
    ]);
    await expect(createAlpaca({ fetch }).history("X", KEYS)).rejects.toThrow("no data");
  });

  it("turns 404 (unknown symbol) and 401 (bad keys) into HttpError", async () => {
    const nf = fakeFetch([
      ["/snapshot", { status: 404, fixture: "alpaca/snapshot-notfound.json" }],
      ["/bars", { json: { bars: [] } }],
    ]);
    await expect(createAlpaca({ fetch: nf }).history("NOPEXYZQ", KEYS)).rejects.toMatchObject({ status: 404 });
    const unauth = fakeFetch([[/./, { status: 401, fixture: "alpaca/unauthorized.html" }]]);
    const e = await createAlpaca({ fetch: unauth })
      .history("AAPL", KEYS)
      .catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(401);
  });
});

describe("alpaca.quotes", () => {
  it("batches the symbols into one snapshots request and leaves out unknown ones", async () => {
    const fetch = fakeFetch(routes());
    const j = fixture("alpaca/snapshots-AAPL-MSFT-BRK.B.json");
    const q = await createAlpaca({ fetch }).quotes(["AAPL", "BRK.B", "MSFT", "NOPE"], KEYS);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe(
      "https://data.alpaca.markets/v2/stocks/snapshots?feed=iex&symbols=AAPL,BRK.B,MSFT,NOPE",
    );
    expect(fetch.calls[0].options.headers["APCA-API-KEY-ID"]).toBe("test-key-id");
    expect(Object.keys(q).sort()).toEqual(["AAPL", "BRK.B", "MSFT"]);
    expect(q.AAPL).toEqual({ price: j.AAPL.latestTrade.p, ref: j.AAPL.prevDailyBar.c });
  });

  it("encodes each symbol", async () => {
    const fetch = fakeFetch([[/./, { json: {} }]]);
    await createAlpaca({ fetch }).quotes(["A B", "C&D"], KEYS);
    expect(fetch.calls[0].url).toMatch(/symbols=A%20B,C%26D$/);
  });

  it("throws HttpError on 5xx", async () => {
    const fetch = fakeFetch([[/./, { status: 503 }]]);
    await expect(createAlpaca({ fetch }).quotes(["AAPL"], KEYS)).rejects.toMatchObject({ status: 503 });
  });
});

describe("readAlpacaKeys", () => {
  /** @param {Record<string, string>} env @param {{ calls: any[] }} log */
  const envExec = (env, log) => async (command, args) => {
    log.calls.push({ command, args });
    const name = (args.at(-1).match(/APCA_API_\w+/) ?? [])[0];
    return { code: 0, stdout: `${env[name] ?? ""}\r\n`, stderr: "" };
  };

  it("reads both keys with powershell (User, then Process) on win32", async () => {
    const log = { calls: [] };
    const exec = envExec({ APCA_API_KEY_ID: "kid", APCA_API_SECRET_KEY: "sec" }, log);
    expect(await readAlpacaKeys({ exec, platform: "win32" })).toEqual({ key: "kid", secret: "sec" });
    expect(log.calls).toHaveLength(2);
    expect(log.calls[0].command).toBe("powershell");
    expect(log.calls[0].args.slice(0, 2)).toEqual(["-NoProfile", "-Command"]);
    expect(log.calls[0].args[2]).toBe(
      "$v=[Environment]::GetEnvironmentVariable('APCA_API_KEY_ID','User'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('APCA_API_KEY_ID','Process')}; $v",
    );
    expect(log.calls[1].args[2]).toContain("'APCA_API_SECRET_KEY','User'");
  });

  it('treats platform "windows" like win32', async () => {
    const log = { calls: [] };
    await readAlpacaKeys({ exec: envExec({}, log), platform: "windows" });
    expect(log.calls[0].command).toBe("powershell");
  });

  it("uses a login shell elsewhere", async () => {
    const log = { calls: [] };
    const exec = envExec({ APCA_API_KEY_ID: "kid", APCA_API_SECRET_KEY: "sec" }, log);
    expect(await readAlpacaKeys({ exec, platform: "darwin" })).toEqual({ key: "kid", secret: "sec" });
    expect(log.calls.map((c) => [c.command, ...c.args])).toEqual([
      ["sh", "-lc", 'printf %s "$APCA_API_KEY_ID"'],
      ["sh", "-lc", 'printf %s "$APCA_API_SECRET_KEY"'],
    ]);
  });

  it("is null when either key is missing", async () => {
    const log = { calls: [] };
    expect(await readAlpacaKeys({ exec: envExec({ APCA_API_KEY_ID: "kid" }, log), platform: "linux" })).toBeNull();
    expect(await readAlpacaKeys({ exec: envExec({}, log), platform: "win32" })).toBeNull();
  });

  it("is null when exec fails (no powershell / no sh) or answers nothing", async () => {
    const fails = async () => {
      throw new Error("not installed");
    };
    expect(await readAlpacaKeys({ exec: fails, platform: "win32" })).toBeNull();
    expect(await readAlpacaKeys({ exec: async () => ({}), platform: "linux" })).toBeNull();
  });
});

describe("ALPACA_STREAM", () => {
  it("is the IEX stream", () => {
    expect(ALPACA_STREAM).toBe("wss://stream.data.alpaca.markets/v2/iex");
  });
});
