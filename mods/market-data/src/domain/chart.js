// The popup chart's maths: ranges, gridlines, downsampling to bars, the y scale, hover, and change.
import { signed, percent, decimalsOf } from "./format.js";

/** @typedef {import("./markets.js").MarketKind} MarketKind */
/** @typedef {{ key: string, label: string, interval: string }} ChartRange */

/** The chart's ranges, as Yahoo's chart endpoint names them, with the bar interval for each. */
export const RANGES = /** @type {readonly ChartRange[]} */ ([
  { key: "1d", label: "1D", interval: "5m" },
  { key: "5d", label: "5D", interval: "15m" },
  { key: "1mo", label: "1M", interval: "1h" },
  { key: "6mo", label: "6M", interval: "1d" },
  { key: "ytd", label: "YTD", interval: "1d" },
  { key: "1y", label: "1Y", interval: "1d" },
  { key: "5y", label: "5Y", interval: "1wk" },
  { key: "max", label: "Max", interval: "1mo" },
]);

/**
 * What to ask Yahoo's chart endpoint for a range. `rolling`: markets that never close (crypto, FX)
 * get 2 days for 1D, to be cut to the last 24 hours (trimToLast24h), not just the part since
 * midnight UTC. Unknown keys get 1D's interval.
 * @param {string} rangeKey
 * @param {boolean} [rolling]
 * @returns {{ span: string, interval: string, rolling: boolean }} rolling: whether to trim to 24h
 */
export function chartRequest(rangeKey, rolling = false) {
  const { interval } = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const span = rolling && rangeKey === "1d" ? "2d" : rangeKey;
  return { span, interval, rolling: span !== rangeKey };
}

/**
 * Keeps the points of the last 24 hours (measured back from the last point). New arrays.
 * @param {number[]} closes
 * @param {number[]} times epoch seconds, one per close
 * @returns {{ closes: number[], times: number[] }}
 */
export function trimToLast24h(closes, times) {
  const k = times.findIndex((t) => t >= times.at(-1) - 86400);
  if (k > 0) return { closes: closes.slice(k), times: times.slice(k) };
  return { closes: closes.slice(), times: times.slice() };
}

/**
 * Round-number gridlines between lo and hi (about `count` of them) and the decimals they need.
 * @param {number} lo
 * @param {number} hi
 * @param {number} count
 * @returns {{ ticks: number[], decimals: number }}
 */
export function niceTicks(lo, hi, count) {
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const raw = span / count,
    mag = 10 ** Math.floor(Math.log10(raw)),
    f = raw / mag;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = m * mag;
  const decimals = Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0)));
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, decimals };
}

/**
 * The price axis' width: as wide as its longest label (tiny coins have long ones), at least 64 px.
 * @param {string[]} labels the formatted prices it may show (the last and the highest)
 * @returns {number}
 */
export function axisWidth(labels) {
  return Math.max(64, 22 + 6.4 * Math.max(...labels.map((l) => l.length)));
}

/**
 * One point per value, or per bucket when there are more values than points: bucket i ends at
 * value floor((i+1)·len/maxBars)−1 and shows that value. `idx` maps each point back to its value.
 * @param {number[]} values
 * @param {number} maxBars
 * @returns {{ idx: number[], pts: number[] }}
 */
export function bucket(values, maxBars) {
  const idx =
    values.length <= maxBars
      ? values.map((_, i) => i)
      : Array.from({ length: maxBars }, (_, i) =>
          Math.min(values.length - 1, Math.floor(((i + 1) * values.length) / maxBars) - 1),
        );
  return { idx, pts: idx.map((i) => values[i]) };
}

/**
 * The y scale: the data's lo/hi (widened to `base` when given: a stock's previous close on 1D),
 * padded 10% below and 6% above so the line keeps off the edges. y(v) is px from the top.
 * @param {number[]} pts
 * @param {number} height px
 * @param {number | null} [base]
 * @returns {{ lo: number, hi: number, dlo: number, dhi: number, y: (v: number) => number }}
 */
export function yScale(pts, height, base = null) {
  let lo = Math.min(...pts),
    hi = Math.max(...pts);
  if (base != null) {
    lo = Math.min(lo, base);
    hi = Math.max(hi, base);
  }
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const dlo = lo - span * 0.1,
    dhi = hi + span * 0.06;
  return { lo, hi, dlo, dhi, y: (v) => (1 - (v - dlo) / (dhi - dlo)) * height };
}

/**
 * How many points the line draws: about one per 2 px, at least 2.
 * @param {number} width px
 * @returns {number}
 */
export function pointCount(width) {
  return Math.max(2, Math.floor(width / 2));
}

/**
 * Point i of n, in % of the plot's width: the first at the left edge, the last at the right.
 * @param {number} i
 * @param {number} n
 * @returns {number}
 */
export function pointPct(i, n) {
  return n <= 1 ? 50 : (i / (n - 1)) * 100;
}

/**
 * The point nearest the pointer (the inverse of pointPct). Clamped to 0..n−1.
 * @param {number} x px from the plot's left
 * @param {number} width the plot's width (null when unknown)
 * @param {number} n points
 * @returns {number | null} null without a width
 */
export function nearestIndex(x, width, n) {
  if (!width) return null;
  return Math.max(0, Math.min(n - 1, Math.round((x / width) * (n - 1))));
}

/**
 * What a range's change is measured against: on a stock's 1D the previous close, otherwise the
 * first point.
 * @param {number[]} closes
 * @param {{ chartPreviousClose?: number, previousClose?: number } | null | undefined} meta
 * @param {string} rangeKey
 * @param {MarketKind} kind
 * @returns {number}
 */
export function chartBase(closes, meta, rangeKey, kind) {
  return rangeKey === "1d" && kind === "stock"
    ? (meta?.chartPreviousClose ?? meta?.previousClose ?? closes[0])
    : closes[0];
}

/**
 * The % change from base to v: "+1.23%".
 * @param {number} v
 * @param {number} base
 * @returns {string}
 */
export function changePct(v, base) {
  return `${percent(((v - base) / base) * 100)}%`;
}

/**
 * A point's change against the base, for the hover tip: "+1.25 (+0.67%)".
 * @param {number} v
 * @param {number} base
 * @returns {string}
 */
export function pointChange(v, base) {
  return `${signed(v - base, decimalsOf(v))} (${changePct(v, base)})`;
}

/**
 * A range's change, for the chart's header: "+1.23% today" (stock 1D), "-0.50% in 24h" (crypto/FX
 * 1D), "+12.00% over 6M". `stock1d` says whether to draw the previous close (dashed).
 * @param {number[]} closes at least one
 * @param {{ chartPreviousClose?: number, previousClose?: number } | null | undefined} meta
 * @param {string} rangeKey
 * @param {MarketKind} kind
 * @returns {{ base: number, last: number, up: boolean, stock1d: boolean, pct: string, summary: string }}
 */
export function rangeChange(closes, meta, rangeKey, kind) {
  const stock1d = rangeKey === "1d" && kind === "stock";
  const base = chartBase(closes, meta, rangeKey, kind);
  const last = closes.at(-1);
  const pct = changePct(last, base);
  const label = RANGES.find((r) => r.key === rangeKey)?.label ?? rangeKey;
  const when = rangeKey === "1d" ? (kind === "stock" ? "today" : "in 24h") : `over ${label}`;
  return { base, last, up: last >= base, stock1d, pct, summary: `${pct} ${when}` };
}
