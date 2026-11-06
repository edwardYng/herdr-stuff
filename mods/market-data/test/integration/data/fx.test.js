import { describe, expect, it } from "vitest";
import { createFx } from "../../../src/data/fx.js";
import { HttpError, UA } from "../../../src/data/http.js";
import { fakeFetch, fixture } from "./fakes.js";

const NOW = Date.parse("2026-11-05T21:00:00Z");
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=5m&range=2d";
const FRANKFURTER = "https://api.frankfurter.dev/v1/2026-10-06..2026-11-05?base=EUR&symbols=USD";

describe("fx.history", () => {
  it("uses Yahoo's 5-minute chart: the last 288 closes, meta price and previous close", async () => {
    const fetch = fakeFetch([["finance.yahoo.com", { fixture: "yahoo/chart/EURUSD-2d.json" }]]);
    const r = fixture("yahoo/chart/EURUSD-2d.json").chart.result[0];
    const h = await createFx({ fetch, now: () => NOW }).history("EUR/USD");
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]).toEqual({ url: YAHOO, options: { headers: { "User-Agent": UA } } });
    const closes = r.indicators.quote[0].close.filter((x) => x != null);
    expect(h.spark).toEqual(closes.slice(-288));
    expect(h.spark.length).toBeLessThanOrEqual(288);
    expect(h.price).toBe(r.meta.regularMarketPrice);
    expect(h.ref).toBe(r.meta.previousClose ?? r.meta.chartPreviousClose);
    expect(h.daily).toBeUndefined();
  });

  it("takes chartPreviousClose when there's no previousClose", async () => {
    const json = { chart: { result: [{ meta: { regularMarketPrice: 2, chartPreviousClose: 1 } }] } };
    const fetch = fakeFetch([[/./, { json }]]);
    expect(await createFx({ fetch }).history("EUR/USD")).toEqual({ price: 2, ref: 1, spark: [] });
  });

  it.each([
    ["a 5xx", { status: 500 }],
    ["a 404", { status: 404, fixture: "yahoo/chart/notfound.json" }],
    ["no result", { json: { chart: { result: [] } } }],
    ["a network error", { error: new TypeError("fetch failed") }],
  ])("falls back to 30 days of Frankfurter rates on %s", async (_, yahoo) => {
    const fetch = fakeFetch([
      ["finance.yahoo.com", yahoo],
      ["frankfurter", { fixture: "frankfurter/EUR-USD-30d.json" }],
    ]);
    const j = fixture("frankfurter/EUR-USD-30d.json");
    const rates = Object.keys(j.rates)
      .sort()
      .map((d) => j.rates[d].USD);
    const h = await createFx({ fetch, now: () => NOW }).history("EUR/USD");
    expect(fetch.calls[1].url).toBe(FRANKFURTER);
    expect(fetch.calls[1].options).toBeUndefined();
    expect(h).toEqual({ price: rates.at(-1), ref: rates.at(-2), spark: rates, daily: true });
  });

  it("sorts Frankfurter's dates and uses the one rate as ref when there's only one", async () => {
    const fetch = fakeFetch([
      ["finance.yahoo.com", { status: 503 }],
      ["frankfurter", { json: { rates: { "2026-11-05": { JPY: 150 } } } }],
    ]);
    expect(await createFx({ fetch, now: () => NOW }).history("USD/JPY")).toEqual({
      price: 150,
      ref: 150,
      spark: [150],
      daily: true,
    });
    expect(fetch.calls[1].url).toContain("?base=USD&symbols=JPY");
  });

  it("throws Yahoo's error when Frankfurter fails too", async () => {
    const fetch = fakeFetch([
      ["finance.yahoo.com", { status: 503 }],
      ["frankfurter", { status: 404, json: { message: "not found" } }],
    ]);
    const e = await createFx({ fetch, now: () => NOW })
      .history("EUR/XXX")
      .catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(503);
  });

  it("throws Yahoo's error when Frankfurter has no rates", async () => {
    const fetch = fakeFetch([
      ["finance.yahoo.com", { json: { chart: { result: null } } }],
      ["frankfurter", { json: { rates: {} } }],
    ]);
    await expect(createFx({ fetch }).history("EUR/XXX")).rejects.toThrow("no data");
    const noRates = fakeFetch([
      ["finance.yahoo.com", { status: 500 }],
      ["frankfurter", { json: {} }],
    ]);
    await expect(createFx({ fetch: noRates }).history("EUR/XXX")).rejects.toMatchObject({ status: 500 });
  });
});
