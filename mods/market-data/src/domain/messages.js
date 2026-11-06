// Live stream messages → ticks. Binance: combined-stream miniTicker. Alpaca: arrays of events.

/** @typedef {{ sym: string, price: number, ref: number }} BinanceTick */
/**
 * One Alpaca stream event: `T` is "t" (trade: `S` symbol, `p` price), "success", "subscription",
 * "error" (`code`, `msg`)...
 * @typedef {{ T: string, S?: string, p?: number, code?: number, msg?: string, [k: string]: any }} AlpacaEvent
 */

/**
 * A Binance combined-stream message → { sym: "BTCUSDT", price (last), ref (24h open) }, or null for
 * anything that isn't a 24hrMiniTicker (or isn't JSON).
 * @param {string} text
 * @returns {BinanceTick | null}
 */
export function parseBinanceTicker(text) {
  try {
    const d = JSON.parse(text).data;
    return d && d.e === "24hrMiniTicker" ? { sym: d.s, price: +d.c, ref: +d.o } : null;
  } catch {
    return null;
  }
}

/**
 * An Alpaca stream message → its events (trades and control messages). [] when it isn't JSON or
 * isn't an array.
 * @param {string} text
 * @returns {AlpacaEvent[]}
 */
export function parseAlpacaMessages(text) {
  try {
    const events = JSON.parse(text);
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
