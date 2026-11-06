// Binance public API (no key): crypto history, the pair's 24h stats, every listed pair, streams.
import { getJson } from "./http.js";

/** @typedef {import("./http.js").FetchFn} FetchFn */
/** @typedef {{ price: number, ref?: number, spark: number[], daily?: boolean }} History */

const BINANCE = "https://api.binance.com";

/** "BTC/USDT" → "BTCUSDT" @param {string} sym */
const pair = (sym) => sym.replace("/", "");

/**
 * The combined mini-ticker stream for some pairs.
 * @param {string[]} syms "BTC/USDT", ...
 * @returns {string}
 */
export const binanceStreamUrl = (syms) =>
  `wss://stream.binance.com:9443/stream?streams=${syms.map((s) => `${pair(s).toLowerCase()}@miniTicker`).join("/")}`;

/** @param {{ fetch: FetchFn }} deps */
export function createBinance({ fetch }) {
  /** @type {Set<string> | null} */
  let pairs = null;
  /** @type {Promise<Set<string> | null> | null} */
  let loading = null;

  return {
    /**
     * The last 24h in 5-minute candles. ref is the 24h open.
     * @param {string} sym "BTC/USDT"
     * @returns {Promise<History>}
     * @throws {import("./http.js").HttpError} (400 for an unknown symbol); Error("no data") for no candles.
     */
    async history(sym) {
      const k = await getJson(fetch, `${BINANCE}/api/v3/klines?symbol=${pair(sym)}&interval=5m&limit=288`);
      if (!k?.length) throw new Error("no data");
      const spark = k.map((/** @type {any[]} */ c) => +c[4]);
      return { price: spark.at(-1), ref: +k[0][1], spark };
    },

    /**
     * The pair's own 24h statistics (Binance's raw object: lastPrice, highPrice, volume, ...).
     * @param {string} sym "BTC/USDT"
     * @returns {Promise<any>}
     * @throws {import("./http.js").HttpError}
     */
    ticker24h(sym) {
      return getJson(fetch, `${BINANCE}/api/v3/ticker/24hr?symbol=${pair(sym)}`);
    },

    /**
     * Every symbol Binance trades ("BTCUSDT", ...). Loaded once per client; a failure isn't cached.
     * @returns {Promise<Set<string> | null>} null when Binance is unreachable (then don't filter).
     */
    pairs() {
      if (pairs) return Promise.resolve(pairs);
      loading ??= (async () => {
        try {
          const list = await getJson(fetch, `${BINANCE}/api/v3/ticker/price`);
          pairs = new Set(list.map((/** @type {{ symbol: string }} */ x) => x.symbol));
        } catch {
          // unreachable: answer null, try again next time
        } finally {
          loading = null;
        }
        return pairs;
      })();
      return loading;
    },

    streamUrl: binanceStreamUrl,
  };
}
