// Alpaca market data (IEX feed, free plan): US stocks. Keys come from the user's environment
// (APCA_API_KEY_ID / APCA_API_SECRET_KEY), read through exec so setting them needs no restart.
import { getJson } from "./http.js";

/** @typedef {import("./http.js").FetchFn} FetchFn */
/** @typedef {{ key: string, secret: string }} AlpacaKeys */
/** @typedef {{ price: number, ref?: number }} StockQuote */
/** @typedef {{ price: number, ref?: number, spark: number[], daily?: boolean }} History */
/** @typedef {(command: string, args?: string[]) => Promise<{ stdout: string }>} ExecFn */

const ALPACA = "https://data.alpaca.markets";

/** Alpaca's live trade stream for the IEX feed. */
export const ALPACA_STREAM = "wss://stream.data.alpaca.markets/v2/iex";

/** @param {AlpacaKeys} keys */
const authHeaders = (keys) => ({ "APCA-API-KEY-ID": keys.key, "APCA-API-SECRET-KEY": keys.secret });

/**
 * Latest price and what the day change is measured against (the previous session's close).
 * @param {any} snap
 * @returns {{ price: number | undefined, ref: number | undefined }}
 */
function snapQuote(snap) {
  return { price: snap?.latestTrade?.p ?? snap?.dailyBar?.c, ref: snap?.prevDailyBar?.c };
}

/**
 * @param {{ fetch: FetchFn, now?: () => number }} deps `now` is for tests (the bars' start time).
 */
export function createAlpaca({ fetch, now = Date.now }) {
  return {
    /**
     * Snapshot + the last 78 five-minute bars (about one session).
     * @param {string} sym "AAPL", "BRK.B"
     * @param {AlpacaKeys} keys
     * @returns {Promise<History>}
     * @throws {import("./http.js").HttpError} for a non-2xx answer; Error("no data") when neither
     *   the snapshot nor the bars have a price.
     */
    async history(sym, keys) {
      const h = authHeaders(keys);
      const start = new Date(now() - 5 * 86400e3).toISOString();
      const s = encodeURIComponent(sym);
      const [snap, bars] = await Promise.all([
        getJson(fetch, `${ALPACA}/v2/stocks/${s}/snapshot?feed=iex`, h),
        getJson(fetch, `${ALPACA}/v2/stocks/${s}/bars?timeframe=5Min&feed=iex&sort=desc&limit=78&start=${start}`, h),
      ]);
      /** @type {number[]} */
      const spark = (bars?.bars ?? []).map((/** @type {any} */ b) => b.c).reverse();
      const q = snapQuote(snap);
      const price = q.price ?? spark.at(-1);
      if (price == null) throw new Error("no data");
      return { price, ref: q.ref, spark };
    },

    /**
     * Latest price + previous close for many stocks in one request. Symbols Alpaca doesn't know are
     * left out of the result.
     * @param {string[]} syms
     * @param {AlpacaKeys} keys
     * @returns {Promise<Record<string, { price: number | undefined, ref: number | undefined }>>}
     * @throws {import("./http.js").HttpError}
     */
    async quotes(syms, keys) {
      const j = await getJson(
        fetch,
        `${ALPACA}/v2/stocks/snapshots?feed=iex&symbols=${syms.map(encodeURIComponent).join(",")}`,
        authHeaders(keys),
      );
      /** @type {Record<string, { price: number | undefined, ref: number | undefined }>} */
      const out = {};
      for (const s of syms) if (j?.[s]) out[s] = snapQuote(j[s]);
      return out;
    },
  };
}

/**
 * Reads the keys from the user's environment, fresh each time. Windows: the User variable, then
 * the Process one (powershell). Elsewhere: a login shell, so profile exports count.
 * @param {{ exec: ExecFn, platform: string }} deps
 * @returns {Promise<AlpacaKeys | null>} null unless both are set (or exec fails).
 */
export async function readAlpacaKeys({ exec, platform }) {
  const windows = platform === "win32" || platform === "windows";
  /** @param {string} name */
  const read = async (name) => {
    try {
      const r = windows
        ? await exec("powershell", [
            "-NoProfile",
            "-Command",
            `$v=[Environment]::GetEnvironmentVariable('${name}','User'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('${name}','Process')}; $v`,
          ])
        : await exec("sh", ["-lc", `printf %s "$${name}"`]);
      return (r?.stdout ?? "").trim();
    } catch {
      return "";
    }
  };
  const [key, secret] = await Promise.all([read("APCA_API_KEY_ID"), read("APCA_API_SECRET_KEY")]);
  return key && secret ? { key, secret } : null;
}
