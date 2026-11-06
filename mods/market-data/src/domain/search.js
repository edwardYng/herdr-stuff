// The add box's suggestions: what's typed + Yahoo's search hits + Binance's pairs → ranked markets.
import { parseMarket, binanceSymbol } from "./markets.js";

/** @typedef {import("./markets.js").Market} Market */
/** @typedef {"Stock" | "ETF" | "Crypto" | "FX"} SuggestionType */
/** @typedef {{ market: Market, name: string, type: SuggestionType, exchange: string }} Suggestion */
/**
 * One hit from Yahoo's /v1/finance/search `quotes` (the fields used here).
 * @typedef {{ symbol?: string, quoteType?: string, exchange?: string, exchDisp?: string,
 *   shortname?: string, longname?: string }} YahooSearchQuote
 */

/** Most suggestions shown. */
export const MAX_SUGGESTIONS = 8;

/** Alpaca only has US listings: Nasdaq, NYSE, NYSE American/Arca, Cboe BZX. */
export const US_EXCHANGES = new Set(["NMS", "NGM", "NCM", "NAS", "NYQ", "NYS", "ASE", "PCX", "BTS"]);

/**
 * Type words in the search box: "sui crypto", "etf gold", "eur fx".
 * @type {Readonly<Record<string, SuggestionType>>}
 */
export const TYPE_WORDS = {
  crypto: "Crypto",
  coin: "Crypto",
  coins: "Crypto",
  token: "Crypto",
  tokens: "Crypto",
  stock: "Stock",
  stocks: "Stock",
  share: "Stock",
  shares: "Stock",
  equity: "Stock",
  etf: "ETF",
  etfs: "ETF",
  fund: "ETF",
  funds: "ETF",
  fx: "FX",
  forex: "FX",
  currency: "FX",
  currencies: "FX",
};

/**
 * "sui crypto" → { terms: "sui", type: "Crypto" }. Whole words only, so a half-typed "cry" doesn't
 * filter yet; a word on its own is searched for, not a filter ("coin" still finds Coinbase); and
 * the last type word is the filter, an earlier one part of the name ("coin stock" = Coinbase).
 * @param {string} text
 * @returns {{ terms: string, type: SuggestionType | null }}
 */
export function parseQuery(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { terms: words.join(" "), type: null };
  let at = -1;
  words.forEach((w, i) => {
    if (Object.hasOwn(TYPE_WORDS, w.toLowerCase())) at = i;
  });
  if (at < 0) return { terms: words.join(" "), type: null };
  return { terms: words.filter((_, i) => i !== at).join(" "), type: TYPE_WORDS[words[at].toLowerCase()] };
}

/**
 * What to ask Yahoo's search for: the terms, and how many hits (more when a type filters them).
 * @param {string} text what's typed
 * @returns {{ terms: string, type: SuggestionType | null, quotesCount: number }}
 */
export function searchPlan(text) {
  const { terms, type } = parseQuery(text);
  return { terms, type, quotesCount: type ? 25 : 12 };
}

/**
 * One Yahoo search hit → the market plus what to show, or null if the tile can't follow it
 * (futures, indexes, non-US stocks...). Yahoo numbers coins whose ticker is taken twice
 * (PEPE24478-USD is Pepe): the base loses the number and the market keeps Yahoo's symbol as ysym.
 * @param {YahooSearchQuote} q
 * @returns {Suggestion | null}
 */
export function toSuggestion(q) {
  const s = q.symbol ?? "";
  /** @type {Market | null} */
  let m = null;
  /** @type {SuggestionType} */
  let label;
  if (
    (q.quoteType === "EQUITY" || q.quoteType === "ETF") &&
    US_EXCHANGES.has(q.exchange) &&
    /^[A-Z][A-Z0-9-]{0,9}$/.test(s)
  ) {
    m = parseMarket(`stock:${s.replace(/-/g, ".")}`);
    label = q.quoteType === "ETF" ? "ETF" : "Stock";
  } else if (q.quoteType === "CRYPTOCURRENCY") {
    const [rawBase, quote] = s.split("-");
    const base = rawBase?.replace(/^([A-Z]+)\d{4,}$/, "$1");
    if (base && quote) m = parseMarket(`crypto:${base}/${quote === "USD" ? "USDT" : quote}`);
    if (m && rawBase !== base) m.ysym = s;
    label = "Crypto";
  } else if (q.quoteType === "CURRENCY") {
    const pair = /^[A-Z]{3}\/[A-Z]{3}$/.test(q.shortname ?? "")
      ? q.shortname
      : /^[A-Z]{6}=X$/.test(s)
        ? `${s.slice(0, 3)}/${s.slice(3, 6)}`
        : null;
    if (pair) m = parseMarket(`fx:${pair}`);
    label = "FX";
  }
  if (!m) return null;
  let name = q.longname ?? q.shortname ?? "";
  if (m.kind === "crypto") name = name.replace(/ [A-Z]{3}$/, ""); // "Bitcoin USD" → "Bitcoin"
  return { market: m, name, type: label, exchange: q.exchDisp ?? q.exchange ?? "" };
}

/**
 * Binance itself: coins Yahoo misses or ranks low ("arb" finds no crypto on Yahoo at all). The
 * query as a base (BASE/USDT) always; bases starting with it only when nothing of the wanted type
 * was found yet and the query has 3+ characters ("pep" → PEPE). Leveraged tokens (BTCUP, ETHDOWN)
 * are skipped. At most 3, exact first then shortest. Named like Yahoo named the coin under another
 * quote, else "<BASE> on Binance". Nothing when a non-crypto type filters, or without pairs.
 * @param {string} query the search terms, upper-cased
 * @param {Iterable<string> | null | undefined} pairs every Binance symbol ("BTCUSDT"...)
 * @param {Suggestion[]} found the suggestions so far (from Yahoo); these are not repeated
 * @param {SuggestionType | null} [type]
 * @returns {Suggestion[]} the ones to add after `found`
 */
export function binanceMatches(query, pairs, found, type = null) {
  const Q = query;
  if (!pairs || !/^[A-Z0-9]{2,12}$/.test(Q) || (type && type !== "Crypto")) return [];
  const nothingYet = !found.some((x) => !type || x.type === type);
  const bases = [];
  for (const p of pairs) {
    if (!p.endsWith("USDT") || !p.startsWith(Q)) continue;
    const base = p.slice(0, -4);
    if (base === Q || (nothingYet && Q.length >= 3 && !/(UP|DOWN|BULL|BEAR)$/.test(base))) bases.push(base);
  }
  bases.sort((a, b) => (a === Q ? -1 : b === Q ? 1 : a.length - b.length || a.localeCompare(b)));
  const seen = new Set(found.map((x) => x.market.id));
  /** @type {Suggestion[]} */
  const out = [];
  for (const base of bases.slice(0, 3)) {
    const m = parseMarket(`crypto:${base}/USDT`);
    if (!m || seen.has(m.id)) continue;
    // Yahoo's name for the coin if it listed it under another quote (BTC-EUR...).
    const named = found.find((x) => x.market.kind === "crypto" && x.market.sym.split("/")[0] === base);
    seen.add(m.id);
    out.push({ market: m, name: named?.name ?? `${base} on Binance`, type: "Crypto", exchange: "Binance" });
  }
  return out;
}

/**
 * Keeps only `type` (when given) and puts exact symbol matches first (AAPL, or SOL as a crypto
 * base), then prefixes, then the rest in their order (Yahoo ranks by popularity: "sol" gives First
 * Solar before Solana). At most MAX_SUGGESTIONS.
 * @param {Suggestion[]} list
 * @param {string} query the search terms, upper-cased
 * @param {SuggestionType | null} [type]
 * @returns {Suggestion[]}
 */
export function rankSuggestions(list, query, type = null) {
  /** @param {Suggestion} x */
  const rank = (x) => {
    const [base] = x.market.sym.split("/");
    return x.market.sym === query || base === query ? 0 : base.startsWith(query) ? 1 : 2;
  };
  return list
    .filter((x) => !type || x.type === type)
    .map((x, i) => /** @type {[number, number, Suggestion]} */ ([rank(x), i, x]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((e) => e[2])
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Suggestions for what's typed, best first, from Yahoo's search hits and Binance's pairs. Yahoo's
 * crypto hits Binance doesn't trade are dropped (when the pairs are known). Throws "offline" when
 * there's nothing at all and Binance's pairs are unknown too (both sources unreachable).
 * @param {{ text: string, quotes?: YahooSearchQuote[] | null, pairs?: Set<string> | null }} input
 *   text: what's typed (type words included); quotes: Yahoo's hits ([] when Yahoo failed);
 *   pairs: every Binance symbol, null when Binance is unreachable
 * @returns {Suggestion[]}
 */
export function buildSuggestions({ text, quotes, pairs }) {
  const { terms, type } = parseQuery(text);
  if (!terms) return [];
  const Q = terms.trim().toUpperCase();
  const hits = quotes ?? [];
  const seen = new Set();
  /** @type {Suggestion[]} */
  const out = [];
  for (const q of hits) {
    const s = toSuggestion(q);
    if (!s || seen.has(s.market.id)) continue;
    if (s.market.kind === "crypto" && pairs && !pairs.has(binanceSymbol(s.market.sym))) continue;
    seen.add(s.market.id);
    out.push(s);
  }
  out.push(...binanceMatches(Q, pairs, out, type));
  if (!hits.length && !out.length && !pairs) throw new Error("offline");
  return rankSuggestions(out, Q, type);
}
