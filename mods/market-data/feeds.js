// Data sources for the market-data tile. No UI here.
//   stocks: Alpaca (IEX feed, free plan)  — keys from APCA_API_KEY_ID / APCA_API_SECRET_KEY
//   crypto: Binance public API            — no key
//   fx:     Yahoo Finance chart endpoint  — no key; Frankfurter (ECB, daily) as fallback
import { exec } from "herdr";
import process from "process";

const FIAT = new Set(("USD EUR GBP JPY CAD AUD NZD CHF CNY CNH HKD SGD SEK NOK DKK MXN ZAR " +
  "TRY INR KRW BRL PLN CZK HUF ILS THB TWD").split(" "));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const ALPACA = "https://data.alpaca.markets";
const BINANCE = "https://api.binance.com";

/** "AAPL" → stock, "BTC/USDT" → crypto, "EUR/USD" → fx. Prefixes stock:/crypto:/fx: force it.
 *  Returns { id, kind, sym } or null if it can't be a market. */
export function parseMarket(text) {
  let s = text.trim().toUpperCase().replace(/\s+/g, "");
  let kind = null;
  const m = s.match(/^(STOCK|CRYPTO|FX):(.+)$/);
  if (m) { kind = m[1].toLowerCase(); s = m[2]; }
  s = s.replace(/[-_]/g, "/");
  // "BTCUSDT" → "BTC/USDT" (stock tickers are never this long with these endings)
  const q = !s.includes("/") && kind !== "stock" && kind !== "fx" && s.match(/^([A-Z0-9]{2,})(USDT|USDC|FDUSD|BTC|ETH|BNB)$/);
  if (q && (kind === "crypto" || s.length >= 6)) { s = `${q[1]}/${q[2]}`; kind = "crypto"; }
  if (!kind) {
    const pair = s.match(/^([A-Z0-9]+)\/([A-Z0-9]+)$/);
    if (pair) kind = FIAT.has(pair[1]) && FIAT.has(pair[2]) ? "fx" : "crypto";
    else if (/^[A-Z]{6}$/.test(s) && FIAT.has(s.slice(0, 3)) && FIAT.has(s.slice(3))) { kind = "fx"; s = `${s.slice(0, 3)}/${s.slice(3)}`; }
    else kind = "stock";
  }
  if (kind === "stock" && !/^[A-Z][A-Z0-9.]{0,9}$/.test(s)) return null;
  if (kind !== "stock") {
    if (!s.includes("/") && kind === "fx" && /^[A-Z]{6}$/.test(s)) s = `${s.slice(0, 3)}/${s.slice(3)}`;
    if (!/^[A-Z0-9]+\/?[A-Z0-9]+$/.test(s)) return null;
  }
  return { id: `${kind}:${s}`, kind, sym: s };
}

// ---- Alpaca keys ----------------------------------------------------------

/** Reads the keys fresh each time (so setting them doesn't need a Herdr restart). */
export async function alpacaKeys() {
  const read = async (name) => {
    try {
      if (process.platform === "windows" || process.platform === "win32") {
        const r = await exec("powershell", ["-NoProfile", "-Command",
          `$v=[Environment]::GetEnvironmentVariable('${name}','User'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('${name}','Process')}; $v`]);
        return r.stdout.trim();
      }
      const r = await exec("sh", ["-lc", `printf %s "$${name}"`]);
      return r.stdout.trim();
    } catch { return ""; }
  };
  const [key, secret] = await Promise.all([read("APCA_API_KEY_ID"), read("APCA_API_SECRET_KEY")]);
  return key && secret ? { key, secret } : null;
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---- History + reference price (one call per refresh) ---------------------
// Each returns { price, ref, spark: number[] }. ref is what % change is measured against.

export async function stockHistory(sym, keys) {
  const h = { "APCA-API-KEY-ID": keys.key, "APCA-API-SECRET-KEY": keys.secret };
  const start = new Date(Date.now() - 5 * 86400e3).toISOString();
  const [snap, bars] = await Promise.all([
    getJson(`${ALPACA}/v2/stocks/${encodeURIComponent(sym)}/snapshot?feed=iex`, h),
    getJson(`${ALPACA}/v2/stocks/${encodeURIComponent(sym)}/bars?timeframe=5Min&feed=iex&sort=desc&limit=78&start=${start}`, h),
  ]);
  const spark = (bars.bars ?? []).map((b) => b.c).reverse();
  const q = snapQuote(snap);
  if (q.price == null) q.price = spark.at(-1);
  if (q.price == null) throw new Error("no data");
  return { ...q, spark };
}

// Change is against the previous session's close (the usual "day change").
function snapQuote(snap) {
  return { price: snap?.latestTrade?.p ?? snap?.dailyBar?.c, ref: snap?.prevDailyBar?.c };
}

/** Latest price + previous close for many stocks in one request: { SYM: { price, ref } }. */
export async function stockQuotes(syms, keys) {
  const h = { "APCA-API-KEY-ID": keys.key, "APCA-API-SECRET-KEY": keys.secret };
  const j = await getJson(`${ALPACA}/v2/stocks/snapshots?feed=iex&symbols=${syms.map(encodeURIComponent).join(",")}`, h);
  const out = {};
  for (const s of syms) if (j[s]) out[s] = snapQuote(j[s]);
  return out;
}

export async function cryptoHistory(sym) {
  const s = sym.replace("/", "");
  const k = await getJson(`${BINANCE}/api/v3/klines?symbol=${s}&interval=5m&limit=288`);
  if (!k.length) throw new Error("no data");
  const spark = k.map((c) => +c[4]);
  return { price: spark.at(-1), ref: +k[0][1], spark };
}

export async function fxHistory(sym) {
  const [a, b] = sym.split("/");
  try {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${a}${b}=X?interval=5m&range=2d`, { "User-Agent": UA });
    const r = j.chart?.result?.[0];
    if (!r) throw new Error("no data");
    const spark = (r.indicators?.quote?.[0]?.close ?? []).filter((x) => x != null).slice(-288);
    return { price: r.meta.regularMarketPrice, ref: r.meta.previousClose ?? r.meta.chartPreviousClose, spark };
  } catch (e) {
    // Fallback: European Central Bank daily rates. Not live, but never blank.
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const j = await getJson(`https://api.frankfurter.dev/v1/${start}..${end}?base=${a}&symbols=${b}`);
    const spark = Object.keys(j.rates ?? {}).sort().map((d) => j.rates[d][b]).filter((x) => x != null);
    if (!spark.length) throw e;
    return { price: spark.at(-1), ref: spark.at(-2) ?? spark.at(-1), spark, daily: true };
  }
}

// ---- Live streams ---------------------------------------------------------

export const ALPACA_STREAM = "wss://stream.data.alpaca.markets/v2/iex";
export const binanceStream = (syms) =>
  `wss://stream.binance.com:9443/stream?streams=${syms.map((s) => `${s.replace("/", "").toLowerCase()}@miniTicker`).join("/")}`;

/** Binance combined-stream message → { sym: "BTCUSDT", price, ref } or null. */
export function parseBinance(text) {
  try {
    const d = JSON.parse(text).data;
    return d && d.e === "24hrMiniTicker" ? { sym: d.s, price: +d.c, ref: +d.o } : null;
  } catch { return null; }
}

/** Alpaca stream message → [{ sym, price }] for trades, plus control messages. */
export function parseAlpaca(text) {
  try { return JSON.parse(text); } catch { return []; }
}

// ---- Formatting -----------------------------------------------------------

export function formatPrice(p, kind, sym) {
  if (p == null || !isFinite(p)) return "—";
  let d;
  if (kind === "fx") d = sym.includes("JPY") || p >= 20 ? 3 : 4;
  else if (p >= 1) d = 2;
  else if (p >= 0.01) d = 4;
  else d = 8;
  const [int, frac] = p.toFixed(d).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}

export function formatChange(p, ref) {
  if (p == null || !ref) return "";
  const c = ((p - ref) / ref) * 100;
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`;
}
