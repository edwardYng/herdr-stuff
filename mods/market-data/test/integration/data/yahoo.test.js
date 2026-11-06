import { describe, expect, it } from "vitest";
import { HttpError, UA } from "../../../src/data/http.js";
import { createYahooSession } from "../../../src/data/yahoo-session.js";
import { createYahoo, SUMMARY_MODULES } from "../../../src/data/yahoo.js";
import { fakeCurl, fakeFetch, fcHeaders, fixture, memoryStorage } from "./fakes.js";

const Q1 = "https://query1.finance.yahoo.com";
const noSession = { get: async () => ({ status: 500, body: "" }) };

/** @param {{ status: number, body: string }} answer */
const sessionAnswering = (answer) => {
  const urls = [];
  return { urls, get: async (url) => (urls.push(url), answer) };
};

describe("yahoo.chart", () => {
  it("asks for the range with its interval and the UA, and drops null closes with their times", async () => {
    const fetch = fakeFetch([["/v8/finance/chart/", { fixture: "yahoo/chart/AAPL-1d.json" }]]);
    const r = fixture("yahoo/chart/AAPL-1d.json").chart.result[0];
    const c = await createYahoo({ fetch, session: noSession }).chart("AAPL", "1d");
    expect(fetch.calls[0]).toEqual({
      url: `${Q1}/v8/finance/chart/AAPL?range=1d&interval=5m`,
      options: { headers: { "User-Agent": UA } },
    });
    const kept = r.indicators.quote[0].close.map((x, i) => [x, r.timestamp[i]]).filter(([x]) => x != null);
    expect(c.closes).toEqual(kept.map((k) => k[0]));
    expect(c.times).toEqual(kept.map((k) => k[1]));
    expect(c.meta).toEqual(r.meta);
  });

  it.each([
    ["5d", "15m"],
    ["1mo", "1h"],
    ["ytd", "1d"],
    ["5y", "1wk"],
    ["max", "1mo"],
    ["bogus", "5m"],
  ])("range %s → interval %s, encoded symbol", async (range, interval) => {
    const fetch = fakeFetch([[/./, { fixture: "yahoo/chart/AAPL-1d.json" }]]);
    await createYahoo({ fetch, session: noSession }).chart("EURUSD=X", range, { rolling: true });
    expect(fetch.calls[0].url).toBe(`${Q1}/v8/finance/chart/EURUSD%3DX?range=${range}&interval=${interval}`);
  });

  it("rolling 1D: asks for 2 days and keeps the last 24 hours", async () => {
    const fetch = fakeFetch([[/./, { fixture: "yahoo/chart/BTC-USD-2d.json" }]]);
    const r = fixture("yahoo/chart/BTC-USD-2d.json").chart.result[0];
    const c = await createYahoo({ fetch, session: noSession }).chart("BTC-USD", "1d", { rolling: true });
    expect(fetch.calls[0].url).toBe(`${Q1}/v8/finance/chart/BTC-USD?range=2d&interval=5m`);
    const all = r.timestamp.filter((_, i) => r.indicators.quote[0].close[i] != null);
    expect(c.times.length).toBeLessThan(all.length);
    expect(c.times.at(-1)).toBe(all.at(-1));
    expect(c.times[0]).toBeGreaterThanOrEqual(all.at(-1) - 86400);
    expect(all[all.length - c.times.length - 1]).toBeLessThan(all.at(-1) - 86400);
    expect(c.closes).toHaveLength(c.times.length);
  });

  it("not rolling: 1D is the plain 1d range", async () => {
    const fetch = fakeFetch([[/./, { fixture: "yahoo/chart/BTC-USD-2d.json" }]]);
    const c = await createYahoo({ fetch, session: noSession }).chart("BTC-USD", "1d");
    expect(fetch.calls[0].url).toContain("range=1d&");
    expect(c.times[0]).toBeLessThan(c.times.at(-1) - 86400);
  });

  it("copes with a result without quotes", async () => {
    const fetch = fakeFetch([[/./, { json: { chart: { result: [{ meta: { symbol: "X" } }] } } }]]);
    expect(await createYahoo({ fetch, session: noSession }).chart("X", "1d")).toEqual({
      meta: { symbol: "X" },
      closes: [],
      times: [],
    });
  });

  it('throws HttpError "404" for an unknown symbol and "no data" for an empty result', async () => {
    const nf = fakeFetch([[/./, { status: 404, fixture: "yahoo/chart/notfound.json" }]]);
    const e = await createYahoo({ fetch: nf, session: noSession })
      .chart("NOPEXYZQ", "1d")
      .catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).toBe("404");
    const empty = fakeFetch([[/./, { json: { chart: { result: [] } } }]]);
    await expect(createYahoo({ fetch: empty, session: noSession }).chart("X", "1d")).rejects.toThrow("no data");
  });
});

describe("yahoo.search", () => {
  it("returns Yahoo's raw quotes", async () => {
    const fetch = fakeFetch([["/v1/finance/search", { fixture: "yahoo/search/apple.json" }]]);
    const quotes = await createYahoo({ fetch, session: noSession }).search("apple", 12);
    expect(quotes).toEqual(fixture("yahoo/search/apple.json").quotes);
    expect(quotes.some((q) => q.symbol === "AAPL" && q.quoteType === "EQUITY")).toBe(true);
    expect(fetch.calls[0]).toEqual({
      url: `${Q1}/v1/finance/search?q=apple&quotesCount=12&newsCount=0&listsCount=0`,
      options: { headers: { "User-Agent": UA } },
    });
  });

  it("encodes the text and passes the count", async () => {
    const fetch = fakeFetch([[/./, { json: {} }]]);
    expect(await createYahoo({ fetch, session: noSession }).search("s&p 500/x", 25)).toEqual([]);
    expect(fetch.calls[0].url).toContain("?q=s%26p%20500%2Fx&quotesCount=25&");
  });

  it("throws HttpError instead of answering []", async () => {
    const fetch = fakeFetch([[/./, { status: 429 }]]);
    await expect(createYahoo({ fetch, session: noSession }).search("a", 12)).rejects.toMatchObject({ status: 429 });
  });
});

describe("yahoo.quoteSummary", () => {
  it("asks the session for the modules and returns the result", async () => {
    const session = sessionAnswering({ status: 200, body: JSON.stringify(fixture("yahoo/summary/AAPL.json")) });
    const res = await createYahoo({ fetch: fakeFetch([]), session }).quoteSummary("BRK-B");
    expect(session.urls).toEqual([`${Q1}/v10/finance/quoteSummary/BRK-B?modules=${SUMMARY_MODULES}`]);
    expect(SUMMARY_MODULES).toBe(
      "price,summaryDetail,defaultKeyStatistics,calendarEvents,financialData,assetProfile,fundProfile",
    );
    expect(res.price.symbol).toBe("AAPL");
    expect(res).toHaveProperty("summaryDetail");
    expect(res).toHaveProperty("assetProfile");
  });

  it("encodes the symbol", async () => {
    const session = sessionAnswering({ status: 200, body: JSON.stringify(fixture("yahoo/summary/AAPL.json")) });
    await createYahoo({ fetch: fakeFetch([]), session }).quoteSummary("EURUSD=X");
    expect(session.urls[0]).toContain("/quoteSummary/EURUSD%3DX?");
  });

  it.each([
    ["404", { status: 404, body: JSON.stringify(fixture("yahoo/summary/notfound.json")) }, 404, "not found"],
    ["an empty result", { status: 200, body: '{"quoteSummary":{"result":[]}}' }, 404, "not found"],
    ["500", { status: 500, body: "" }, 500, "500"],
    ["no answer", { status: 0, body: "" }, 0, "offline"],
  ])("%s → HttpError", async (_, answer, status, message) => {
    const e = await createYahoo({ fetch: fakeFetch([]), session: sessionAnswering(answer) })
      .quoteSummary("NOPEXYZQ")
      .catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status, message });
  });

  it.each([401, 403])("%i after the retry → Yahoo refused", async (status) => {
    const y = createYahoo({ fetch: fakeFetch([]), session: sessionAnswering({ status, body: "" }) });
    await expect(y.quoteSummary("AAPL")).rejects.toThrow("Yahoo refused");
  });

  it("bad JSON → bad response", async () => {
    const y = createYahoo({ fetch: fakeFetch([]), session: sessionAnswering({ status: 200, body: "<html>" }) });
    await expect(y.quoteSummary("AAPL")).rejects.toThrow("bad response");
  });

  it("works end to end through a curl session, refreshing a stale crumb", async () => {
    const storage = memoryStorage({ yahoo: JSON.stringify({ cookie: "A3=old", crumb: "old" }) });
    const exec = fakeCurl([
      [(u) => u === "https://fc.yahoo.com", { status: 404, headers: fcHeaders("new") }],
      [(u) => u.endsWith("/v1/test/getcrumb"), { body: "fresh" }],
      [(u) => u.endsWith("crumb=old"), { status: 401, fixture: "yahoo/summary/unauthorized.json" }],
      [(u) => u.includes("/quoteSummary/AAPL?"), { fixture: "yahoo/summary/AAPL.json" }],
    ]);
    const session = createYahooSession({ exec, platform: "win32", storage });
    const res = await createYahoo({ fetch: fakeFetch([]), session }).quoteSummary("AAPL");
    expect(res.price.symbol).toBe("AAPL");
    expect(exec.calls.every((c) => c.command === "curl.exe")).toBe(true);
    expect(JSON.parse(storage.data.get("yahoo"))).toEqual({ cookie: "A3=new", crumb: "fresh" });
  });
});
