// FX history: Yahoo's chart (live, 5-minute), falling back to Frankfurter (ECB daily rates).
import { getJson, UA } from "./http.js";

/** @typedef {import("./http.js").FetchFn} FetchFn */
/** @typedef {{ price: number, ref?: number, spark: number[], daily?: boolean }} History */

/**
 * @param {{ fetch: FetchFn, now?: () => number }} deps `now` is for tests (Frankfurter's dates).
 */
export function createFx({ fetch, now = Date.now }) {
  return {
    /**
     * The last 24h (288 five-minute closes) from Yahoo; if Yahoo fails, 30 days of ECB rates with
     * `daily: true`. Not live, but never blank.
     * @param {string} sym "EUR/USD"
     * @returns {Promise<History>}
     * @throws Yahoo's error (an HttpError or Error("no data")) when Frankfurter has nothing either.
     */
    async history(sym) {
      const [a, b] = sym.split("/");
      try {
        const j = await getJson(
          fetch,
          `https://query1.finance.yahoo.com/v8/finance/chart/${a}${b}=X?interval=5m&range=2d`,
          {
            "User-Agent": UA,
          },
        );
        const r = j?.chart?.result?.[0];
        if (!r) throw new Error("no data");
        /** @type {number[]} */
        const spark = (r.indicators?.quote?.[0]?.close ?? []).filter((/** @type {any} */ x) => x != null).slice(-288);
        return { price: r.meta.regularMarketPrice, ref: r.meta.previousClose ?? r.meta.chartPreviousClose, spark };
      } catch (e) {
        try {
          const end = new Date(now()).toISOString().slice(0, 10);
          const start = new Date(now() - 30 * 86400e3).toISOString().slice(0, 10);
          const j = await getJson(fetch, `https://api.frankfurter.dev/v1/${start}..${end}?base=${a}&symbols=${b}`);
          const rates = j?.rates ?? {};
          /** @type {number[]} */
          const spark = Object.keys(rates)
            .sort()
            .map((d) => rates[d][b])
            .filter((x) => x != null);
          if (spark.length) return { price: spark.at(-1), ref: spark.at(-2) ?? spark.at(-1), spark, daily: true };
        } catch {
          // Frankfurter failing too: report what went wrong first
        }
        throw e;
      }
    },
  };
}
