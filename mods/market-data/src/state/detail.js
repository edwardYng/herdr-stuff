// The details popup's data: Yahoo's quote page (reloaded every 30 s), a chart per range (cached),
// Binance's 24h stats for crypto, and what the pointer and the toggles chose.
import { closeOverlay } from "herdr";
import { yahooSymbol } from "../domain/markets.js";

/** @typedef {import("../domain/markets.js").Market} Market */
/** @typedef {import("../domain/quote.js").QuoteSummary} QuoteSummary */
/** @typedef {import("../domain/quote.js").Binance24h} Binance24h */
/** @typedef {import("../data/yahoo.js").ChartData} ChartData */
/** @typedef {import("../data/index.js").DataSources} DataSources */
/** @typedef {import("gpui-kit").Context} Context */
/**
 * What the tile opens the popup with: the market, and its own numbers to show until Yahoo answers.
 * `overlay`: the popup's id (Herdr adds it).
 * @typedef {{ market: Market, price?: number | null, ref?: number | null, overlay?: string }} DetailProps
 */

export const RELOAD_MS = 30e3;

/** Yahoo Finance's page for a symbol. @param {string} ysym */
export const quotePage = (ysym) => `https://finance.yahoo.com/quote/${encodeURIComponent(ysym)}/`;

export class Detail {
  /**
   * @param {DetailProps} props
   * @param {{ data: DataSources }} deps
   */
  constructor(props, { data }) {
    this.data = data;
    /** @type {Market} */
    this.m = props.market;
    this.overlay = props.overlay;
    /** The tile's price and reference, until Yahoo answers. */
    this.seed = { price: props.price ?? null, ref: props.ref ?? null };
    this.ysym = yahooSymbol(this.m);
    /** @type {QuoteSummary | null} */
    this.q = null;
    this.qErr = "";
    this.range = "1d";
    /** @type {Record<string, ChartData>} range key → chart */
    this.charts = {};
    this.chartErr = "";
    /** @type {Binance24h | null} */
    this.bin = null;
    /** The hovered bar, or null. */
    this.hover = /** @type {number | null} */ (null);
    /** About's text shown whole. */
    this.more = false;
  }

  /**
   * Loads the quote and the 1D chart, and reloads both every RELOAD_MS.
   * @param {Context} cx
   */
  start(cx) {
    this.load(cx);
    this.loadChart(cx, this.range);
    cx.timer.every(RELOAD_MS, (cx) => {
      this.load(cx);
      this.loadChart(cx, this.range, true);
    });
  }

  /** The chart of the selected range, once loaded. */
  chart() {
    return this.charts[this.range] ?? null;
  }

  /** The 1D chart's meta: the header's and the basic summary's fallback. */
  chartMeta() {
    return this.charts["1d"]?.meta ?? null;
  }

  /**
   * The quote page (an error keeps the last one and says why), and for crypto Binance's 24h stats.
   * @param {Context} cx
   */
  load(cx) {
    cx.spawn(async (cx) => {
      try {
        this.q = await this.data.yahoo.quoteSummary(this.ysym);
        this.qErr = "";
      } catch (e) {
        this.qErr = /** @type {any} */ (e)?.message ?? String(e);
      }
      cx.notify();
    });
    if (this.m.kind === "crypto") {
      cx.spawn(async (cx) => {
        try {
          this.bin = await this.data.binance.ticker24h(this.m.sym);
        } catch {
          // the section stays out (or keeps the last answer)
        }
        cx.notify();
      });
    }
  }

  /**
   * A range's chart, unless it's loaded already (`force`: reload it anyway). An error only shows
   * while that range has no chart.
   * @param {Context} cx
   * @param {string} range
   * @param {boolean} [force]
   */
  loadChart(cx, range, force = false) {
    if (this.charts[range] && !force) return;
    cx.spawn(async (cx) => {
      try {
        this.charts[range] = await this.data.yahoo.chart(this.ysym, range, { rolling: this.m.kind !== "stock" });
        this.chartErr = "";
      } catch (e) {
        const notFound = /** @type {any} */ (e)?.status === 404;
        if (!this.charts[range]) this.chartErr = notFound ? "No chart for this symbol" : "Chart unavailable";
      }
      cx.notify();
    });
  }

  /**
   * @param {string} range
   * @param {Context} cx
   */
  setRange(range, cx) {
    this.range = range;
    this.hover = null;
    this.loadChart(cx, range);
    cx.notify();
  }

  /**
   * @param {number | null} i the bar under the pointer, null when it left
   * @param {Context} cx
   */
  setHover(i, cx) {
    if (i === this.hover) return;
    this.hover = i;
    cx.notify();
  }

  /** @param {Context} cx */
  toggleMore(cx) {
    this.more = !this.more;
    cx.notify();
  }

  /** The × button. */
  close() {
    if (this.overlay) closeOverlay(this.overlay);
  }
}
