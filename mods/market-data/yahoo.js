// Yahoo Finance details for the popup. No UI here.
//   quoteSummary: everything on a Yahoo quote page (stats, profile, fund data). Needs Yahoo's A3
//                 cookie + a "crumb". fetch() can't read Set-Cookie, so these calls go through curl.
//   chart:        price history for the popup chart, and a fallback for the basics. No cookie.
//   binance24h:   the pair's own 24h stats on Binance (crypto only).
import { exec } from "herdr";
import process from "process";
import { parseMarket } from "./feeds.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const Q1 = "https://query1.finance.yahoo.com";
const MODULES = "price,summaryDetail,defaultKeyStatistics,calendarEvents,financialData,assetProfile,fundProfile";
const STABLES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USDP"]);

/** The tile's market → Yahoo's symbol: AAPL, BRK-B, BTC-USD, EURUSD=X. */
export function yahooSymbol(m) {
  if (m.ysym) return m.ysym;
  if (m.kind === "fx") return `${m.sym.replace("/", "")}=X`;
  if (m.kind === "crypto") {
    const [base, quote] = m.sym.split("/");
    return `${base}-${STABLES.has(quote) ? "USD" : quote}`;
  }
  return m.sym.replace(/\./g, "-");
}

export const quotePage = (ysym) => `https://finance.yahoo.com/quote/${encodeURIComponent(ysym)}/`;

// ---- curl -----------------------------------------------------------------

async function curl(url, cookie, withHeaders = false) {
  const args = ["-s", "--compressed", "--max-time", "12", "-A", UA, "-w", "\n%{http_code}"];
  if (withHeaders) args.push("-i");
  if (cookie) args.push("-H", `Cookie: ${cookie}`);
  args.push(url);
  const r = await exec(process.platform === "win32" || process.platform === "windows" ? "curl.exe" : "curl", args);
  const out = r.stdout ?? "";
  const i = out.lastIndexOf("\n");
  return { status: Number(out.slice(i + 1)) || 0, body: out.slice(0, i) };
}

// The cookie lasts about a year and the crumb goes with it: keep them until Yahoo says no.
let session = null;
try { session = JSON.parse(localStorage.getItem("yahoo") ?? "null"); } catch {}

async function newSession() {
  // fc.yahoo.com answers 404, but sets the A3 cookie on the way.
  const r = await curl("https://fc.yahoo.com", null, true);
  const cookie = r.body.match(/^set-cookie:\s*(A3=[^;\r\n]+)/im)?.[1];
  if (!cookie) throw new Error("no Yahoo cookie");
  const c = await curl(`${Q1}/v1/test/getcrumb`, cookie);
  const crumb = c.body.trim();
  if (c.status !== 200 || !crumb || crumb.includes("<") || crumb.includes("{")) throw new Error("no Yahoo crumb");
  session = { cookie, crumb };
  try { localStorage.setItem("yahoo", JSON.stringify(session)); } catch {}
  return session;
}

/** quoteSummary result: { price, summaryDetail, defaultKeyStatistics, ... } (modules a type lacks are absent). */
export async function quoteSummary(ysym) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = attempt === 0 && session ? session : await newSession();
    const r = await curl(`${Q1}/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}`, s.cookie);
    if (r.status === 401 || r.status === 403) { session = null; continue; }
    if (r.status === 404) throw new Error("not found");
    if (r.status !== 200) throw new Error(`${r.status || "offline"}`);
    const res = JSON.parse(r.body).quoteSummary?.result?.[0];
    if (!res) throw new Error("not found");
    return res;
  }
  throw new Error("Yahoo refused");
}

// ---- chart ----------------------------------------------------------------

export const RANGES = [
  { key: "1d", label: "1D", interval: "5m" },
  { key: "5d", label: "5D", interval: "15m" },
  { key: "1mo", label: "1M", interval: "1h" },
  { key: "6mo", label: "6M", interval: "1d" },
  { key: "ytd", label: "YTD", interval: "1d" },
  { key: "1y", label: "1Y", interval: "1d" },
  { key: "5y", label: "5Y", interval: "1wk" },
  { key: "max", label: "Max", interval: "1mo" },
];

/** { meta, closes: number[], times: number[] } for a range key. `rolling`: markets that never
 *  close (crypto, FX) get the last 24 hours for 1D, not just the part since midnight UTC. */
export async function chart(ysym, range, rolling = false) {
  const { interval } = RANGES.find((r) => r.key === range) ?? RANGES[0];
  const span = rolling && range === "1d" ? "2d" : range;
  const res = await fetch(`${Q1}/v8/finance/chart/${encodeURIComponent(ysym)}?range=${span}&interval=${interval}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status}`);
  const r = (await res.json()).chart?.result?.[0];
  if (!r) throw new Error("no data");
  const raw = r.indicators?.quote?.[0]?.close ?? [];
  const closes = [], times = [];
  raw.forEach((c, i) => { if (c != null) { closes.push(c); times.push(r.timestamp?.[i]); } });
  if (span !== range) {
    const k = times.findIndex((t) => t >= times.at(-1) - 86400);
    if (k > 0) { closes.splice(0, k); times.splice(0, k); }
  }
  return { meta: r.meta, closes, times };
}

// ---- Binance --------------------------------------------------------------

export async function binance24h(sym) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym.replace("/", "")}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---- Search (the add box's suggestions) -------------------------------------

// Alpaca only has US listings: Nasdaq, NYSE, NYSE American/Arca, Cboe BZX.
const US_EXCHANGES = new Set(["NMS", "NGM", "NCM", "NAS", "NYQ", "NYS", "ASE", "PCX", "BTS"]);
const TYPE_LABEL = { stock: "Stock", etf: "ETF", crypto: "Crypto", fx: "FX" };

/** One Yahoo search hit → the tile's market ({ id, kind, sym }) plus what to show, or null if
 *  the tile can't follow it (futures, indexes, non-US stocks...). */
function toSuggestion(q) {
  const s = q.symbol ?? "";
  let m = null, label;
  if ((q.quoteType === "EQUITY" || q.quoteType === "ETF") && US_EXCHANGES.has(q.exchange) && /^[A-Z][A-Z0-9-]{0,9}$/.test(s)) {
    m = parseMarket(`stock:${s.replace(/-/g, ".")}`);
    label = q.quoteType === "ETF" ? TYPE_LABEL.etf : TYPE_LABEL.stock;
  } else if (q.quoteType === "CRYPTOCURRENCY") {
    // Yahoo numbers coins whose ticker is taken twice: PEPE24478-USD is Pepe. Binance just says PEPE.
    const [rawBase, quote] = s.split("-");
    const base = rawBase?.replace(/^([A-Z]+)\d{4,}$/, "$1");
    if (base && quote) m = parseMarket(`crypto:${base}/${quote === "USD" ? "USDT" : quote}`);
    if (m && rawBase !== base) m.ysym = s;
    label = TYPE_LABEL.crypto;
  } else if (q.quoteType === "CURRENCY") {
    const pair = /^[A-Z]{3}\/[A-Z]{3}$/.test(q.shortname ?? "") ? q.shortname
      : /^[A-Z]{6}=X$/.test(s) ? `${s.slice(0, 3)}/${s.slice(3, 6)}` : null;
    if (pair) m = parseMarket(`fx:${pair}`);
    label = TYPE_LABEL.fx;
  }
  if (!m) return null;
  let name = q.longname ?? q.shortname ?? "";
  if (m.kind === "crypto") name = name.replace(/ [A-Z]{3}$/, "");   // "Bitcoin USD" → "Bitcoin"
  return { market: m, name, type: label, exchange: q.exchDisp ?? q.exchange ?? "" };
}

// Every pair Binance trades, loaded once: Yahoo also lists tokens Binance doesn't have (BRKB-USD).
let binancePairs = null;
async function loadBinancePairs() {
  if (binancePairs) return binancePairs;
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price");
    if (r.ok) binancePairs = new Set((await r.json()).map((x) => x.symbol));
  } catch {}
  return binancePairs;   // null if Binance is unreachable: then don't filter
}

// Type words in the search box: "sui crypto", "etf gold", "eur fx". Whole words only, so a
// half-typed "cry" doesn't filter yet; and a word on its own is searched for, not a filter
// ("coin" still finds Coinbase).
const TYPE_WORDS = {
  crypto: "Crypto", coin: "Crypto", coins: "Crypto", token: "Crypto", tokens: "Crypto",
  stock: "Stock", stocks: "Stock", share: "Stock", shares: "Stock", equity: "Stock",
  etf: "ETF", etfs: "ETF", fund: "ETF", funds: "ETF",
  fx: "FX", forex: "FX", currency: "FX", currencies: "FX",
};

/** "sui crypto" → { terms: "sui", type: "Crypto" }; type is null when there's no type word. */
export function parseQuery(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { terms: words.join(" "), type: null };
  // The last type word is the filter; an earlier one is part of the name ("coin stock" = Coinbase).
  let at = -1;
  words.forEach((w, i) => { if (TYPE_WORDS[w.toLowerCase()]) at = i; });
  if (at < 0) return { terms: words.join(" "), type: null };
  return { terms: words.filter((_, i) => i !== at).join(" "), type: TYPE_WORDS[words[at].toLowerCase()] };
}

/** Suggestions for what's typed so far, best first. A type word keeps only that type. */
export async function searchMarkets(text) {
  const { terms, type } = parseQuery(text);
  text = terms;
  if (!text) return [];
  const Q = text.trim().toUpperCase();
  const pairsP = loadBinancePairs();
  // Yahoo failing (or answering nothing) still leaves the Binance matches below.
  let quotes = [];
  try {
    const r = await fetch(`${Q1}/v1/finance/search?q=${encodeURIComponent(text)}&quotesCount=${type ? 25 : 12}&newsCount=0&listsCount=0`,
      { headers: { "User-Agent": UA } });
    if (r.ok) quotes = (await r.json()).quotes ?? [];
  } catch {}
  const pairs = await pairsP;
  const seen = new Set(), out = [];
  for (const q of quotes) {
    const s = toSuggestion(q);
    if (!s || seen.has(s.market.id)) continue;
    if (s.market.kind === "crypto" && pairs && !pairs.has(s.market.sym.replace("/", ""))) continue;
    seen.add(s.market.id); out.push(s);
  }

  // Binance itself: coins Yahoo misses or ranks low ("arb" finds no crypto on Yahoo at all).
  // The typed text as a base; bases starting with it only when nothing else matched
  // ("pep" → PEPE). Leveraged tokens (BTCUP, ETHDOWN) are noise here.
  if (pairs && /^[A-Z0-9]{2,12}$/.test(Q) && (!type || type === "Crypto")) {
    const nothingYet = !out.some((x) => !type || x.type === type);
    const bases = [];
    for (const p of pairs) {
      if (!p.endsWith("USDT") || !p.startsWith(Q)) continue;
      const base = p.slice(0, -4);
      if (base === Q || (nothingYet && Q.length >= 3 && !/(UP|DOWN|BULL|BEAR)$/.test(base))) bases.push(base);
    }
    bases.sort((a, b) => (a === Q ? -1 : b === Q ? 1 : a.length - b.length || a.localeCompare(b)));
    for (const base of bases.slice(0, 3)) {
      const m = parseMarket(`crypto:${base}/USDT`);
      if (!m || seen.has(m.id)) continue;
      // Yahoo's name for the coin if it listed it under another quote (BTC-EUR...).
      const named = out.find((x) => x.market.kind === "crypto" && x.market.sym.split("/")[0] === base);
      seen.add(m.id);
      out.push({ market: m, name: named?.name ?? `${base} on Binance`, type: TYPE_LABEL.crypto, exchange: "Binance" });
    }
  }
  if (!quotes.length && !out.length && !pairs) throw new Error("offline");

  // Yahoo ranks by popularity: "sol" gives First Solar before Solana. Put exact symbol matches
  // (AAPL, or SOL as a crypto base) first, then prefixes, then the rest in Yahoo's order.
  const rank = (x) => { const [base] = x.market.sym.split("/"); return x.market.sym === Q || base === Q ? 0 : base.startsWith(Q) ? 1 : 2; };
  return out.filter((x) => !type || x.type === type).map((x, i) => [rank(x), i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((e) => e[2]).slice(0, 8);
}
