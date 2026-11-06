// Against the real APIs. Opt-in: LIVE=1 npx vitest run --project integration live
// Uses Node's fetch and a real curl (Yahoo's session). Alpaca is left out: it needs the user's keys.
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createBinance } from "../../../src/data/binance.js";
import { createFx } from "../../../src/data/fx.js";
import { createYahooSession } from "../../../src/data/yahoo-session.js";
import { createYahoo } from "../../../src/data/yahoo.js";
import { memoryStorage } from "./fakes.js";

/** @param {string} command @param {string[]} [args] */
const exec = (command, args = []) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { maxBuffer: 8 << 20 }, (err, stdout, stderr) =>
      err && err.code === "ENOENT" ? reject(err) : resolve({ code: err ? 1 : 0, stdout, stderr }),
    ),
  );

const fetchFn = (url, options) => fetch(url, options);

describe.skipIf(process.env.LIVE !== "1")("live APIs", { timeout: 30_000 }, () => {
  const storage = memoryStorage();
  const session = createYahooSession({ exec, platform: process.platform, storage });
  const yahoo = createYahoo({ fetch: fetchFn, session });

  it("Yahoo chart: AAPL 5d and BTC-USD rolling 24h", async () => {
    const aapl = await yahoo.chart("AAPL", "5d");
    expect(aapl.meta.symbol).toBe("AAPL");
    expect(aapl.closes.length).toBeGreaterThan(10);
    const btc = await yahoo.chart("BTC-USD", "1d", { rolling: true });
    expect(btc.times.at(-1) - btc.times[0]).toBeLessThanOrEqual(86400);
    expect(btc.closes.length).toBeGreaterThan(200);
  });

  it("Yahoo search: apple finds AAPL", async () => {
    const quotes = await yahoo.search("apple", 12);
    expect(quotes.some((q) => q.symbol === "AAPL")).toBe(true);
  });

  it("Yahoo quoteSummary through a curl session, then reused from storage", async () => {
    const res = await yahoo.quoteSummary("AAPL");
    expect(res.price.symbol).toBe("AAPL");
    expect(JSON.parse(storage.data.get("yahoo"))).toHaveProperty("crumb");
    const again = createYahoo({
      fetch: fetchFn,
      session: createYahooSession({ exec, platform: process.platform, storage }),
    });
    expect((await again.quoteSummary("MSFT")).price.symbol).toBe("MSFT");
    await expect(yahoo.quoteSummary("NOPEXYZQQ")).rejects.toThrow("not found");
  });

  it("Binance: history, 24h ticker, pairs", async () => {
    const b = createBinance({ fetch: fetchFn });
    const h = await b.history("BTC/USDT");
    expect(h.spark).toHaveLength(288);
    expect((await b.ticker24h("ETH/USDT")).symbol).toBe("ETHUSDT");
    const pairs = await b.pairs();
    expect(pairs.has("BTCUSDT")).toBe(true);
  });

  it("FX: Yahoo, and Frankfurter when Yahoo is down", async () => {
    const fx = createFx({ fetch: fetchFn });
    const h = await fx.history("EUR/USD");
    expect(h.price).toBeGreaterThan(0.5);
    expect(h.daily).toBeUndefined();
    const yahooDown = (url, options) =>
      url.includes("yahoo.com") ? Promise.reject(new Error("down")) : fetch(url, options);
    const d = await createFx({ fetch: yahooDown }).history("EUR/USD");
    expect(d.daily).toBe(true);
    expect(d.spark.length).toBeGreaterThan(10);
  });
});
