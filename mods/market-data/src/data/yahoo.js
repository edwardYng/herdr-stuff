// Yahoo Finance: chart (price history; no cookie), search (raw quotes for the add box) and
// quoteSummary (everything on a quote page; needs the cookie + crumb session).
import { chartRequest, trimToLast24h } from "../domain/chart.js";
import { getJson, HttpError, UA } from "./http.js";

/** @typedef {import("./http.js").FetchFn} FetchFn */
/** @typedef {{ get(url: string): Promise<{ status: number, body: string }> }} YahooSessionLike */
/** @typedef {{ meta: any, closes: number[], times: number[] }} ChartData */

const Q1 = "https://query1.finance.yahoo.com";

/** The quoteSummary modules the popup shows. A quote type that lacks one just leaves it out. */
export const SUMMARY_MODULES =
  "price,summaryDetail,defaultKeyStatistics,calendarEvents,financialData,assetProfile,fundProfile";

/**
 * @param {{ fetch: FetchFn, session: YahooSessionLike }} deps
 */
export function createYahoo({ fetch, session }) {
  return {
    /**
     * Price history for a range key ("1d", "5d", ... "max"; see RANGES). `rolling`: the market never
     * closes (crypto, FX), so 1D is the last 24 hours rather than the part since midnight UTC.
     * @param {string} ysym Yahoo's symbol: AAPL, BTC-USD, EURUSD=X
     * @param {string} range
     * @param {{ rolling?: boolean }} [opts]
     * @returns {Promise<ChartData>}
     * @throws {HttpError} for a non-2xx answer (message "404" for an unknown symbol);
     *   Error("no data") when the answer has no result.
     */
    async chart(ysym, range, { rolling = false } = {}) {
      const req = chartRequest(range, rolling);
      const j = await getJson(
        fetch,
        `${Q1}/v8/finance/chart/${encodeURIComponent(ysym)}?range=${req.span}&interval=${req.interval}`,
        { "User-Agent": UA },
      );
      const r = j?.chart?.result?.[0];
      if (!r) throw new Error("no data");
      /** @type {(number | null)[]} */
      const raw = r.indicators?.quote?.[0]?.close ?? [];
      /** @type {number[]} */
      const closes = [];
      /** @type {number[]} */
      const times = [];
      raw.forEach((c, i) => {
        if (c != null) {
          closes.push(c);
          times.push(r.timestamp?.[i]);
        }
      });
      if (req.rolling) return { meta: r.meta, ...trimToLast24h(closes, times) };
      return { meta: r.meta, closes, times };
    },

    /**
     * Yahoo's search hits for the add box, as Yahoo returns them (symbol, quoteType, exchange,
     * shortname, longname, exchDisp, ...). Turning them into suggestions is the domain's job.
     * @param {string} text
     * @param {number} count quotesCount: 12 normally, 25 when a type word filters
     * @returns {Promise<any[]>}
     * @throws {HttpError} for a non-2xx answer; fetch's error when offline. The caller decides
     *   whether that's fatal (Binance matches can still answer).
     */
    async search(text, count) {
      const j = await getJson(
        fetch,
        `${Q1}/v1/finance/search?q=${encodeURIComponent(text)}&quotesCount=${count}&newsCount=0&listsCount=0`,
        { "User-Agent": UA },
      );
      return j?.quotes ?? [];
    },

    /**
     * The quote page's data: { price, summaryDetail, defaultKeyStatistics, ... }.
     * @param {string} ysym
     * @returns {Promise<any>}
     * @throws {HttpError} status 404, message "not found" for an unknown symbol; status 0, message
     *   "offline" when curl got no answer; other statuses with the status as message.
     *   Error("Yahoo refused") when it says 401/403 even to a new session; the session's errors
     *   ("no Yahoo cookie", "no Yahoo crumb", curl missing) as they are; Error("bad response") for a
     *   200 that isn't JSON.
     */
    async quoteSummary(ysym) {
      const url = `${Q1}/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${SUMMARY_MODULES}`;
      const r = await session.get(url);
      if (r.status === 401 || r.status === 403) throw new Error("Yahoo refused");
      if (r.status === 404) throw new HttpError(404, url, "not found");
      if (r.status !== 200) throw new HttpError(r.status, url);
      let res;
      try {
        res = JSON.parse(r.body)?.quoteSummary?.result?.[0];
      } catch {
        throw new Error("bad response");
      }
      if (!res) throw new HttpError(404, url, "not found");
      return res;
    },
  };
}
