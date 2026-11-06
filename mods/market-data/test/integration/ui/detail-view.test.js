import { describe, it, expect, vi, beforeEach } from "vitest";
import { herdrMock } from "../../../../../test-support/herdr-mock.js";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { textOf, findAll, byId, called } from "../../../../../test-support/element.js";
import { Detail } from "../../../src/state/detail.js";
import { detailView } from "../../../src/ui/detail-view.js";
import { readTheme } from "../../../src/ui/theme.js";
import { RANGES } from "../../../src/domain/chart.js";
import { formatChartTime, formatPrice } from "../../../src/domain/format.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeSources, chartFixture, quoteSummaryFixture } from "../../support/fake-sources.js";

const M = {
  AAPL: { id: "stock:AAPL", kind: "stock", sym: "AAPL" },
  BRKB: { id: "stock:BRK.B", kind: "stock", sym: "BRK.B" },
  SPY: { id: "stock:SPY", kind: "stock", sym: "SPY" },
  BTC: { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" },
  PEPE: { id: "crypto:PEPE/USDT", kind: "crypto", sym: "PEPE/USDT", ysym: "PEPE24478-USD" },
  EURUSD: { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" },
};
const CHARTS = { stock: "AAPL-1d", crypto: "BTC-USD-2d", fx: "EURUSD-2d" };

beforeEach(() => herdrMock.reset());

async function setup(market, { summary, data, props = {} } = {}) {
  data ??= fakeSources({
    yahoo: {
      quoteSummary: vi.fn(async () => (summary ? quoteSummaryFixture(summary) : Promise.reject(new Error("x")))),
      chart: vi.fn(async (_s, range) => chartFixture(range === "1d" ? CHARTS[market.kind] : "AAPL-1d")),
    },
  });
  const cx = createCx();
  const d = new Detail({ market, price: 1, ref: 1, overlay: "ov7", ...props }, { data });
  d.start(cx);
  await cx.flush();
  const ui = {};
  const render = () => detailView(d, ui, readTheme(), 1);
  return { d, ui, cx, data, render };
}

/** Section headings, in order. */
const headings = (el) =>
  findAll(el, (n) => n.calls.some(([m, a]) => m === "text_size" && a[0] === 12.5)).map((n) => textOf(n));

describe("detail view: header and sections per quote type", () => {
  it("stock (AAPL): name, symbol line, price, change, after hours, status; stock sections and About", async () => {
    const { render } = await setup(M.AAPL, { summary: "AAPL" });
    const el = render();
    const text = textOf(el);
    expect(text).toContain("Apple Inc.");
    expect(text).toContain("AAPL · NasdaqGS · Currency in USD");
    expect(text).toContain("344.17");
    expect(textOf(byId(el, "ext-hours"))).toMatch(/^343\.32 \| [-+][\d.]+ \([-+][\d.]+%\) \| After hours$/);
    expect(text).toContain("Market closed");
    expect(headings(el)).toEqual(["Summary", "Valuation & Financials", "About"]);
    expect(text).toContain("Market Cap (intraday)");
    expect(text).toContain("Consumer Electronics");
    expect(textOf(byId(el, "more"))).toBe("Show more");
    expect(text).toContain("Data: Yahoo Finance | Open in Yahoo Finance ↗");
  });

  it("stock with a dot (BRK.B) uses Yahoo's dash symbol", async () => {
    const { render, data } = await setup(M.BRKB, { summary: "BRK-B" });
    expect(data.yahoo.quoteSummary).toHaveBeenCalledWith("BRK-B");
    expect(textOf(render())).toContain("Berkshire Hathaway Inc.");
  });

  it("ETF (SPY): ETF stats and performance", async () => {
    const { render } = await setup(M.SPY, { summary: "SPY" });
    const el = render();
    expect(headings(el)[0]).toBe("Summary");
    expect(headings(el)).toContain("About");
    expect(textOf(el)).toContain("Net Assets");
    expect(textOf(el)).toContain("Expense Ratio (net)");
  });

  it("crypto (BTC): 24/7, crypto stats, Binance's 24h section, Binance in the footer", async () => {
    const { render } = await setup(M.BTC, { summary: "BTC-USD" });
    const el = render();
    const text = textOf(el);
    expect(text).toContain("Bitcoin USD");
    expect(text).toContain("Trades 24/7");
    expect(headings(el)).toEqual(["Summary", "On Binance · BTC/USDT · 24h", "About"]);
    expect(text).toContain("Circulating Supply");
    expect(text).toContain("Data: Yahoo Finance · Binance");
    expect(findAll(el, (n) => n.elId === "more")).toEqual([]);
    expect(findAll(el, (n) => n.elId === "ext-hours")).toEqual([]);
  });

  it("tiny crypto (PEPE): Yahoo's 0.00000 replaced with a readable price", async () => {
    const { render, data } = await setup(M.PEPE, { summary: "PEPE24478-USD" });
    expect(data.yahoo.quoteSummary).toHaveBeenCalledWith("PEPE24478-USD");
    expect(textOf(render())).toContain("Pepe USD");
    expect(textOf(render())).not.toMatch(/\| 0\.00000 \|/);
  });

  it("FX (EUR/USD): bid/ask and averages; no About", async () => {
    const { render } = await setup(M.EURUSD, { summary: "EURUSDX" });
    const el = render();
    expect(textOf(el)).toContain("EUR/USD");
    expect(textOf(el)).toContain("50-Day Average");
    expect(headings(el)).toEqual(["Summary"]);
  });

  it("without Yahoo's details: the tile's price, the chart's basics, and why", async () => {
    const { render } = await setup(M.AAPL, { props: { price: 210, ref: 200 } });
    const el = render();
    const text = textOf(el);
    expect(text).toContain("210.00");
    expect(text).toContain("+10.00 (+5.00%)");
    expect(text).toContain("Previous Close");
    expect(text).toContain("Full details unavailable (x). Showing the basics.");
  });

  it("while loading: a dash for the price, and loading notes", () => {
    const data = fakeSources({
      yahoo: { quoteSummary: vi.fn(() => new Promise(() => {})), chart: vi.fn(() => new Promise(() => {})) },
    });
    const d = new Detail({ market: M.AAPL }, { data });
    const text = textOf(detailView(d, {}, readTheme(), 1));
    expect(text).toContain("--");
    expect(text).toContain("Loading chart…");
    expect(text).toContain("Loading details…");
  });

  it("tables have two columns when wide, one when narrow", async () => {
    const { render, ui, cx } = await setup(M.AAPL, { summary: "AAPL" });
    const cols = (el) => findAll(el, (n) => called(n, "gap", 24)).length;
    expect(cols(render())).toBeGreaterThan(0);
    render().handlers.on_size_change({ width: 400, height: 800 }, cx);
    expect(ui.width).toBe(400);
    expect(cols(render())).toBe(0);
    const n = cx.notifies;
    render().handlers.on_size_change({ width: 400, height: 700 }, cx);
    expect(cx.notifies).toBe(n);
  });
});

describe("detail view: interaction", () => {
  it("× closes the popup", async () => {
    const { render, cx } = await setup(M.AAPL, { summary: "AAPL" });
    byId(render(), "close").handlers.on_click({}, cx);
    expect(herdrMock.closed).toEqual(["ov7"]);
  });

  it("Show more / Show less toggles About's text", async () => {
    const { render, cx, d } = await setup(M.AAPL, { summary: "AAPL" });
    const about = d.q.assetProfile.longBusinessSummary;
    expect(textOf(render())).not.toContain(about);
    byId(render(), "more").handlers.on_click({}, cx);
    expect(textOf(render())).toContain(about);
    expect(textOf(byId(render(), "more"))).toBe("Show less");
  });

  it("the website and Yahoo links open in the browser", async () => {
    const { render, cx } = await setup(M.AAPL, { summary: "AAPL" });
    byId(render(), "site").handlers.on_click({}, cx);
    byId(render(), "yahoo").handlers.on_click({}, cx);
    expect(cx.opened).toEqual(["https://www.apple.com", "https://finance.yahoo.com/quote/AAPL/"]);
  });
});

describe("chart", () => {
  const bars = (el) => findAll(byId(el, "plot"), (n) => /^b\d+$/.test(String(n.elId)));

  it("1D stock: bars, change today, gridlines, the previous close dashed, axis pill at the last price", async () => {
    const { render, d } = await setup(M.AAPL, { summary: "AAPL" });
    const el = render();
    const c = d.chart();
    expect(bars(el).length).toBe(Math.min(c.closes.length, bars(el).length));
    expect(bars(el).length).toBeGreaterThan(10);
    expect(textOf(el)).toMatch(/[-+]\d+\.\d\d% today/);
    expect(findAll(el, (n) => n.elId === "prev-close")).toHaveLength(1);
    expect(textOf(el)).toContain("(dashed)");
    expect(textOf(byId(el, "axis-pill"))).toBe(formatPrice(c.closes.at(-1), "stock", "AAPL"));
    expect(textOf(el)).toContain(formatChartTime(c.times[0], "1d"));
  });

  it("1D crypto: in 24h, no dashed line", async () => {
    const { render } = await setup(M.BTC, { summary: "BTC-USD" });
    const el = render();
    expect(textOf(el)).toMatch(/[-+]\d+\.\d\d% in 24h/);
    expect(findAll(el, (n) => n.elId === "prev-close")).toEqual([]);
  });

  it("hovering shows the crosshair and a tooltip with price, change and time", async () => {
    const { render, d, cx } = await setup(M.AAPL, { summary: "AAPL" });
    const n = bars(render()).length;
    const move = (x) =>
      byId(render(), "plot").handlers.on_mouse_move(
        { local_position: { x, y: 10 }, bounds: { x: 0, y: 0, width: 500, height: 170 } },
        cx,
      );
    move(10);
    expect(d.hover).toBe(Math.floor((10 / 500) * n));
    let el = render();
    const tip = byId(el, "tooltip");
    const i = d.hover;
    const idx = Math.min(d.chart().closes.length - 1, Math.floor(((i + 1) * d.chart().closes.length) / n) - 1);
    const v = d.chart().closes[idx];
    const t = textOf(tip).split(" | ");
    expect(t[0]).toBe(formatPrice(v, "stock", "AAPL"));
    expect(t[1]).toMatch(/^[-+][\d,.]+ \([-+][\d.]+%\)$/);
    expect(t[2]).toBe(formatChartTime(d.chart().times[idx], "1d"));
    expect(byId(el, "crosshair-x")).toBeTruthy();
    expect(textOf(byId(el, "axis-pill"))).toBe(t[0]);
    expect(called(bars(el)[i], "opacity", 1)).toBe(true);
    // On the left half the tip is right of the line; past 60% it flips.
    expect(findAll(el, (x) => x.kids.includes(tip))[0].calls.some(([m]) => m === "left")).toBe(true);
    move(480);
    el = render();
    expect(d.hover).toBe(Math.floor((480 / 500) * n));
    const holder = findAll(el, (x) => x.kids.includes(byId(el, "tooltip")))[0];
    expect(holder.calls.some(([m]) => m === "right")).toBe(true);

    // Without bounds nothing changes; leaving clears the hover.
    byId(render(), "plot").handlers.on_mouse_move({ local_position: { x: 1, y: 1 } }, cx);
    expect(d.hover).toBe(Math.floor((480 / 500) * n));
    byId(render(), "plot").handlers.on_hover(true, cx);
    expect(d.hover).toBe(Math.floor((480 / 500) * n));
    byId(render(), "plot").handlers.on_hover(false, cx);
    expect(d.hover).toBeNull();
    expect(findAll(render(), (x) => x.elId === "tooltip")).toEqual([]);
  });

  it("a range tab loads that range and shows its change", async () => {
    const { render, d, data, cx } = await setup(M.AAPL, { summary: "AAPL" });
    expect(findAll(render(), (n) => /^rng-/.test(String(n.elId))).map((n) => textOf(n))).toEqual(
      RANGES.map((r) => r.label),
    );
    expect(called(byId(render(), "rng-1d"), "bg", "#accent")).toBe(true);
    byId(render(), "rng-6mo").handlers.on_click({}, cx);
    await cx.flush();
    expect(data.yahoo.chart).toHaveBeenLastCalledWith("AAPL", "6mo", { rolling: false });
    expect(d.range).toBe("6mo");
    const el = render();
    expect(textOf(el)).toMatch(/[-+]\d+\.\d\d% over 6M/);
    expect(called(byId(el, "rng-6mo"), "bg", "#accent")).toBe(true);
    expect(findAll(el, (n) => n.elId === "prev-close")).toEqual([]);
  });

  it("chart errors are shown in its place", async () => {
    const data = fakeSources({ yahoo: { chart: vi.fn(async () => Promise.reject(new HttpError(404))) } });
    const { render } = await setup(M.AAPL, { data });
    expect(textOf(render())).toContain("No chart for this symbol");
  });
});
