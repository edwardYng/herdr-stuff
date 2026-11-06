import { describe, expect, it } from "vitest";
import { binanceStreamUrl, createBinance } from "../../../src/data/binance.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeFetch, fixture } from "./fakes.js";

describe("binance.history", () => {
  it("returns 288 closes, the last as price and the first open as ref", async () => {
    const fetch = fakeFetch([["/klines", { fixture: "binance/klines-BTCUSDT.json" }]]);
    const k = fixture("binance/klines-BTCUSDT.json");
    const h = await createBinance({ fetch }).history("BTC/USDT");
    expect(fetch.calls[0].url).toBe("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=288");
    expect(h.spark).toHaveLength(288);
    expect(h.price).toBe(+k.at(-1)[4]);
    expect(h.ref).toBe(+k[0][1]);
    expect(h.spark.every((x) => typeof x === "number")).toBe(true);
  });

  it("throws no data for no candles, HttpError 400 for an unknown symbol", async () => {
    const empty = fakeFetch([[/./, { json: [] }]]);
    await expect(createBinance({ fetch: empty }).history("X/USDT")).rejects.toThrow("no data");
    const bad = fakeFetch([[/./, { status: 400, fixture: "binance/error-invalid-symbol.json" }]]);
    const e = await createBinance({ fetch: bad })
      .history("NOPE/NOPE")
      .catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(400);
  });
});

describe("binance.ticker24h", () => {
  it("returns Binance's object for the pair", async () => {
    const fetch = fakeFetch([["/ticker/24hr", { fixture: "binance/ticker24hr-BTCUSDT.json" }]]);
    const t = await createBinance({ fetch }).ticker24h("BTC/USDT");
    expect(fetch.calls[0].url).toBe("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
    expect(t).toMatchObject({ symbol: "BTCUSDT" });
    expect(t).toHaveProperty("lastPrice");
    expect(t).toHaveProperty("quoteVolume");
  });

  it("throws HttpError on 5xx", async () => {
    const fetch = fakeFetch([[/./, { status: 502 }]]);
    await expect(createBinance({ fetch }).ticker24h("BTC/USDT")).rejects.toMatchObject({ status: 502 });
  });
});

describe("binance.pairs", () => {
  it("loads every symbol once per client", async () => {
    const fetch = fakeFetch([["/ticker/price", { fixture: "binance/ticker-price.json" }]]);
    const b = createBinance({ fetch });
    const [p1, p2] = await Promise.all([b.pairs(), b.pairs()]);
    const p3 = await b.pairs();
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe("https://api.binance.com/api/v3/ticker/price");
    expect(p1).toBeInstanceOf(Set);
    expect(p1.has("BTCUSDT")).toBe(true);
    expect(p1.has("PEPEUSDT")).toBe(true);
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    // another client has its own cache
    await createBinance({ fetch }).pairs();
    expect(fetch.calls).toHaveLength(2);
  });

  it("is null when Binance is unreachable or refuses, and tries again next time", async () => {
    let up = false;
    const fetch = fakeFetch([
      ["/ticker/price", () => (up ? { json: [{ symbol: "ETHUSDT" }] } : { error: new TypeError("fetch failed") })],
    ]);
    const b = createBinance({ fetch });
    expect(await b.pairs()).toBeNull();
    up = true;
    expect([...(await b.pairs())]).toEqual(["ETHUSDT"]);
    expect(fetch.calls).toHaveLength(2);

    const refused = fakeFetch([[/./, { status: 451 }]]);
    expect(await createBinance({ fetch: refused }).pairs()).toBeNull();
  });
});

describe("binance stream URL", () => {
  it("combines lower-case mini-ticker streams", () => {
    const url = "wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/pepeusdt@miniTicker";
    expect(binanceStreamUrl(["BTC/USDT", "PEPE/USDT"])).toBe(url);
    expect(createBinance({ fetch: fakeFetch([]) }).streamUrl(["BTC/USDT", "PEPE/USDT"])).toBe(url);
  });
});
