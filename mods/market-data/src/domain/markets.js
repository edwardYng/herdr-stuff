// Markets: what the watchlist follows, and the symbols each data source knows it by.

/** @typedef {"stock" | "crypto" | "fx"} MarketKind */
/**
 * A market the tile can follow. `id` is `${kind}:${sym}`; `sym` is "AAPL", "BRK.B", "BTC/USDT" or
 * "EUR/USD"; `ysym` is Yahoo's own symbol when it can't be derived (PEPE24478-USD).
 * @typedef {{ id: string, kind: MarketKind, sym: string, ysym?: string }} Market
 */

/** Fiat currencies: a pair of two of these is FX, not crypto. */
export const FIAT = new Set(
  (
    "USD EUR GBP JPY CAD AUD NZD CHF CNY CNH HKD SGD SEK NOK DKK MXN ZAR " + "TRY INR KRW BRL PLN CZK HUF ILS THB TWD"
  ).split(" "),
);

/** Stablecoins: Yahoo prices a coin quoted in one of these as BASE-USD. */
export const STABLECOINS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USDP"]);

/**
 * What's typed → a market. "AAPL" → stock, "BTC/USDT" or "BTCUSDT" → crypto, "EUR/USD" or "EURUSD"
 * → fx. Prefixes `stock:`, `crypto:`, `fx:` force the kind. "-" and "_" work as "/".
 * @param {string} text
 * @returns {Market | null} null if it can't be a market
 */
export function parseMarket(text) {
  let s = text.trim().toUpperCase().replace(/\s+/g, "");
  /** @type {MarketKind | null} */
  let kind = null;
  const m = s.match(/^(STOCK|CRYPTO|FX):(.+)$/);
  if (m) {
    kind = /** @type {MarketKind} */ (m[1].toLowerCase());
    s = m[2];
  }
  s = s.replace(/[-_]/g, "/");
  // "BTCUSDT" → "BTC/USDT" (stock tickers are never this long with these endings)
  const q =
    !s.includes("/") && kind !== "stock" && kind !== "fx" && s.match(/^([A-Z0-9]{2,})(USDT|USDC|FDUSD|BTC|ETH|BNB)$/);
  if (q && (kind === "crypto" || s.length >= 6)) {
    s = `${q[1]}/${q[2]}`;
    kind = "crypto";
  }
  if (!kind) {
    const pair = s.match(/^([A-Z0-9]+)\/([A-Z0-9]+)$/);
    if (pair) kind = FIAT.has(pair[1]) && FIAT.has(pair[2]) ? "fx" : "crypto";
    else if (/^[A-Z]{6}$/.test(s) && FIAT.has(s.slice(0, 3)) && FIAT.has(s.slice(3))) {
      kind = "fx";
      s = `${s.slice(0, 3)}/${s.slice(3)}`;
    } else kind = "stock";
  }
  if (kind === "stock" && !/^[A-Z][A-Z0-9.]{0,9}$/.test(s)) return null;
  if (kind !== "stock") {
    if (!s.includes("/") && kind === "fx" && /^[A-Z]{6}$/.test(s)) s = `${s.slice(0, 3)}/${s.slice(3)}`;
    if (!/^[A-Z0-9]+\/?[A-Z0-9]+$/.test(s)) return null;
  }
  return { id: `${kind}:${s}`, kind, sym: s };
}

/**
 * The market → Yahoo's symbol: AAPL, BRK-B, BTC-USD, EURUSD=X (or `m.ysym` when it has one).
 * @param {Market} m
 * @returns {string}
 */
export function yahooSymbol(m) {
  if (m.ysym) return m.ysym;
  if (m.kind === "fx") return `${m.sym.replace("/", "")}=X`;
  if (m.kind === "crypto") {
    const [base, quote] = m.sym.split("/");
    return `${base}-${STABLECOINS.has(quote) ? "USD" : quote}`;
  }
  return m.sym.replace(/\./g, "-");
}

/**
 * A crypto pair → Binance's symbol: "BTC/USDT" → "BTCUSDT".
 * @param {string} sym
 * @returns {string}
 */
export function binanceSymbol(sym) {
  return sym.replace("/", "");
}
