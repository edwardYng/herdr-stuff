// Formatting: prices, changes, big numbers, tiny prices, chart times, and Yahoo's {raw, fmt} values.

/** @typedef {import("./markets.js").MarketKind} MarketKind */
/**
 * A Yahoo quoteSummary value: `{ raw, fmt, longFmt }`, an empty `{}` when Yahoo has nothing, or a
 * plain string/number for some fields.
 * @typedef {{ raw?: number, fmt?: string, longFmt?: string } | string | number | null | undefined} YahooValue
 */

/** Shown where a value is missing. */
export const DASH = "--";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** @param {string} int */
const groupThousands = (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * A price as the watchlist shows it: FX with 4 decimals (3 for JPY pairs or above 20), others with
 * 2 from 1 up, 4 from 0.01, else 8. "—" when there is no price.
 * @param {number | null | undefined} p
 * @param {MarketKind} kind
 * @param {string} sym
 * @returns {string}
 */
export function formatPrice(p, kind, sym) {
  if (p == null || !isFinite(p)) return "—";
  let d;
  if (kind === "fx") d = sym.includes("JPY") || p >= 20 ? 3 : 4;
  else if (p >= 1) d = 2;
  else if (p >= 0.01) d = 4;
  else d = 8;
  const [int, frac] = p.toFixed(d).split(".");
  return groupThousands(int) + (frac ? `.${frac}` : "");
}

/**
 * The % change from `ref` to `p`: "+1.23%", "-0.40%"; "" when either is missing (or ref is 0).
 * @param {number | null | undefined} p
 * @param {number | null | undefined} ref
 * @returns {string}
 */
export function formatChange(p, ref) {
  if (p == null || !ref) return "";
  const c = ((p - ref) / ref) * 100;
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`;
}

/**
 * A number with thousands separators and `d` decimals: 1234.5 → "1,234.50". null if not finite.
 * @param {number | null | undefined} n
 * @param {number} [d]
 * @returns {string | null}
 */
export function num(n, d = 2) {
  if (n == null || !isFinite(n)) return null;
  const [i, f] = n.toFixed(d).split(".");
  return groupThousands(i) + (f ? `.${f}` : "");
}

/**
 * A big number with a suffix and 2 decimals: 3.2e12 → "3.20T", 1500 → "1.50k". Below 1000: num().
 * @param {number | null | undefined} n
 * @returns {string | null}
 */
export function big(n) {
  if (n == null || !isFinite(n)) return null;
  const a = Math.abs(n);
  /** @type {[number, string][]} */
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [v, s] of units) if (a >= v) return `${(n / v).toFixed(2)}${s}`;
  return num(n);
}

/**
 * Decimals that keep ~4 significant digits of a number below 1 (0.000004903 → 9), at least `min`,
 * at most 12. Numbers of 1 and up (and 0) get `min`.
 * @param {number | null | undefined} n
 * @param {number} [min]
 * @returns {number}
 */
export function sigDecimals(n, min = 2) {
  return n && Math.abs(n) < 1 ? Math.min(12, Math.max(min, 3 - Math.floor(Math.log10(Math.abs(n))))) : min;
}

/**
 * A tiny price with enough decimals to read: 0.0000049103 → "0.000004910".
 * @param {number} n
 * @returns {string}
 */
export function tiny(n) {
  return n.toFixed(sigDecimals(n, 4));
}

/**
 * Decimals a price like this one is shown with: 2 from 20, 4 from 0.01, else enough for ~4 digits.
 * @param {number} p
 * @returns {number}
 */
export function decimalsOf(p) {
  return Math.abs(p) >= 20 ? 2 : Math.abs(p) >= 0.01 ? 4 : sigDecimals(p, 4);
}

/**
 * Signed, at least `d` decimals, more when the number is below 1: "+1.23", "-0.0000012".
 * "" for null.
 * @param {number | null | undefined} n
 * @param {number} [d]
 * @returns {string}
 */
export function signed(n, d = 2) {
  return n == null ? "" : `${n >= 0 ? "+" : ""}${num(n, Math.abs(n) < 1 && n !== 0 ? sigDecimals(n, d) : d)}`;
}

/**
 * A percentage (already ×100) signed and cut to 2 decimals: 1.234 → "+1.23", 0.0199 → "+0.01".
 * No "%" sign. Cut, not rounded, past the second decimal (like Yahoo's quote page).
 * @param {number | null | undefined} n
 * @returns {string}
 */
export function percent(n) {
  return signed(n, 2).replace(/(\.\d\d)\d+/, "$1");
}

// ---- Yahoo values ------------------------------------------------------------

/**
 * Yahoo's own short formatting ("3.98T", "1.23%"), except where it rounds a tiny price to nothing
 * ("0.0000" for PEPE): then tiny(raw). Plain strings/numbers pass through as strings.
 * @param {YahooValue} x
 * @returns {string | null}
 */
export function yFmt(x) {
  if (x == null) return null;
  if (typeof x !== "object") return String(x);
  if (typeof x.raw === "number" && x.raw !== 0 && /^-?0.0*$/.test(x.fmt ?? "")) return tiny(x.raw);
  return x.fmt ?? x.longFmt ?? null;
}

/**
 * Yahoo's long formatting ("45,123,456"), falling back to the short one.
 * @param {YahooValue} x
 * @returns {string | null}
 */
export function yLong(x) {
  if (x == null) return null;
  if (typeof x !== "object") return String(x);
  return x.longFmt ?? x.fmt ?? null;
}

/**
 * The raw number of a Yahoo value (a plain number passes through).
 * @param {YahooValue} x
 * @returns {number | null}
 */
export function yRaw(x) {
  if (x == null) return null;
  if (typeof x === "number") return x;
  if (typeof x !== "object") return null;
  return x.raw ?? null;
}

/**
 * "lo - hi" in Yahoo's formatting, or null unless both are there.
 * @param {YahooValue} lo
 * @param {YahooValue} hi
 * @returns {string | null}
 */
export function yRange(lo, hi) {
  return yFmt(lo) && yFmt(hi) ? `${yFmt(lo)} - ${yFmt(hi)}` : null;
}

/**
 * A bid or ask: "189.50 x 300" (size when Yahoo has one); null when there's no price.
 * @param {YahooValue} price
 * @param {YahooValue} size
 * @returns {string | null}
 */
export function yBidAsk(price, size) {
  return yRaw(price) ? `${yFmt(price)}${yRaw(size) ? ` x ${yLong(size)}` : ""}` : null;
}

/**
 * A market cap or other big amount: Yahoo rounds hard ("5T"); keep two decimals ("4.98T").
 * @param {YahooValue} x
 * @returns {string | null}
 */
export function yCap(x) {
  return big(yRaw(x)) ?? yFmt(x);
}

// ---- Times and text ------------------------------------------------------------

/**
 * A chart point's time in local time: "Nov 5, 12:50" for the intraday ranges (1d, 5d, 1mo),
 * "Nov 5, 2026" for the rest. "" without a time.
 * @param {number | null | undefined} s epoch seconds
 * @param {string} rangeKey
 * @returns {string}
 */
export function formatChartTime(s, rangeKey) {
  if (!s) return "";
  const d = new Date(s * 1000);
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (rangeKey === "1d" || rangeKey === "5d" || rangeKey === "1mo")
    return `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day}, ${d.getFullYear()}`;
}

/**
 * Rough text width in px at a font size (the UI font is proportional; errs slightly wide).
 * @param {string} str
 * @param {number} size
 * @returns {number}
 */
export function textWidth(str, size) {
  let w = 0;
  for (const ch of str) w += ".,:·".includes(ch) ? 0.3 : /[0-9]/.test(ch) ? 0.6 : /[A-Z]/.test(ch) ? 0.68 : 0.55;
  return Math.ceil(w * size);
}
