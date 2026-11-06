// The popup that opens when a row is clicked: a Yahoo Finance–style quote page for one market.
// It's this same mod, opened again as a dialog overlay with props { market, price, ref }.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, closeOverlay } from "herdr";
import { yahooSymbol, quotePage, quoteSummary, chart, binance24h, RANGES } from "./yahoo.js";
import { formatPrice } from "./feeds.js";

const RELOAD_MS = 30e3;
const BAR_W = 3, BAR_GAP = 1, CHART_H = 170;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const DASH = "--";

// Yahoo values come as { raw, fmt, longFmt }. Use Yahoo's own formatting, like its site does.
// Yahoo's own formatting, except where it rounds a tiny price to nothing (PEPE: "0.0000").
const F = (x) => x == null ? null : typeof x !== "object" ? String(x)
  : typeof x.raw === "number" && x.raw !== 0 && /^-?0.0*$/.test(x.fmt ?? "") ? tiny(x.raw) : x.fmt ?? x.longFmt ?? null;
/** Decimals that keep ~4 significant digits of a small number (0.000004903 → 9). */
const sigDecimals = (n, min = 2) => (n && Math.abs(n) < 1 ? Math.min(12, Math.max(min, 3 - Math.floor(Math.log10(Math.abs(n))))) : min);
function tiny(n) { return n.toFixed(sigDecimals(n, 4)); }
const L = (x) => x == null ? null : typeof x !== "object" ? String(x) : x.longFmt ?? x.fmt ?? null;
const R = (x) => x == null ? null : typeof x === "number" ? x : x.raw ?? null;
const range = (lo, hi) => (F(lo) && F(hi) ? `${F(lo)} - ${F(hi)}` : null);
const bidAsk = (p, size) => (R(p) ? `${F(p)}${R(size) ? ` x ${L(size)}` : ""}` : null);
const num = (n, d = 2) => {
  if (n == null || !isFinite(n)) return null;
  const [i, f] = n.toFixed(d).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
};
const big = (n) => {
  if (n == null || !isFinite(n)) return null;
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]]) if (a >= v) return `${(n / v).toFixed(2)}${s}`;
  return num(n);
};
/** Yahoo rounds big numbers hard ("5T"); keep two decimals like its quote page does. */
const cap = (x) => big(R(x)) ?? F(x);
/** Round-number gridlines between lo and hi (about `count` of them) and the decimals they need. */
function niceTicks(lo, hi, count) {
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = m * mag;
  const decimals = Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0)));
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, decimals };
}
/** Decimals a price like this one is shown with. */
const decimalsOf = (p) => (Math.abs(p) >= 20 ? 2 : Math.abs(p) >= 0.01 ? 4 : sigDecimals(p, 4));
/** +1.23 / -0.0000012: at least `d` decimals, more when the number is tiny. */
const signed = (n, d = 2) => n == null ? "" : `${n >= 0 ? "+" : ""}${num(n, Math.abs(n) < 1 && n !== 0 ? sigDecimals(n, d) : d)}`;

const MARKET_STATE = {
  REGULAR: "Market open", PRE: "Pre-market", PREPRE: "Market closed",
  POST: "After hours", POSTPOST: "Market closed", CLOSED: "Market closed",
};

export class Detail {
  constructor(p, cx) {
    this.m = p.market;
    this.overlay = p.overlay;
    this.seed = { price: p.price, ref: p.ref };   // the tile's numbers, until Yahoo answers
    this.ysym = yahooSymbol(this.m);
    this.q = null; this.qErr = "";
    this.range = "1d"; this.charts = {}; this.chartErr = "";
    this.bin = null;
    this.more = false;
    this.load(cx);
    this.loadChart(cx, this.range);
    cx.timer.every(RELOAD_MS, (cx) => { this.load(cx); this.loadChart(cx, this.range, true); });
  }

  close() { if (this.overlay) closeOverlay(this.overlay); }

  load(cx) {
    cx.spawn(async (cx) => {
      try { this.q = await quoteSummary(this.ysym); this.qErr = ""; }
      catch (e) { this.qErr = e?.message ?? String(e); }
      cx.notify();
    });
    if (this.m.kind === "crypto") cx.spawn(async (cx) => {
      try { this.bin = await binance24h(this.m.sym); } catch {}
      cx.notify();
    });
  }

  loadChart(cx, range, force = false) {
    if (this.charts[range] && !force) return;
    cx.spawn(async (cx) => {
      try { this.charts[range] = await chart(this.ysym, range, this.m.kind !== "stock"); this.chartErr = ""; }
      catch (e) { if (!this.charts[range]) this.chartErr = e?.message === "404" ? "No chart for this symbol" : "Chart unavailable"; }
      cx.notify();
    });
  }

  // ---- data → rows ---------------------------------------------------------

  /** Builds what Yahoo shows for this kind of quote: [{ title, rows: [[label, value]] }], plus About. */
  sections() {
    const q = this.q ?? {};
    const P = q.price ?? {}, SD = q.summaryDetail ?? {}, KS = q.defaultKeyStatistics ?? {};
    const CE = q.calendarEvents ?? {}, FD = q.financialData ?? {}, AP = q.assetProfile ?? {}, FP = q.fundProfile ?? {};
    const type = P.quoteType ?? (this.m.kind === "crypto" ? "CRYPTOCURRENCY" : this.m.kind === "fx" ? "CURRENCY" : "EQUITY");
    const out = [];

    if (!this.q) {
      // No quoteSummary (Yahoo said no, or curl is missing): what the chart's meta has.
      const meta = this.charts["1d"]?.meta;
      if (!meta) return out;
      const fp = (v) => (v == null ? null : formatPrice(v, this.m.kind, this.m.sym));
      out.push({ title: "Summary", rows: [
        ["Previous Close", fp(meta.chartPreviousClose ?? meta.previousClose)],
        ["Day's Range", meta.regularMarketDayLow != null ? `${fp(meta.regularMarketDayLow)} - ${fp(meta.regularMarketDayHigh)}` : null],
        ["52 Week Range", meta.fiftyTwoWeekLow != null ? `${fp(meta.fiftyTwoWeekLow)} - ${fp(meta.fiftyTwoWeekHigh)}` : null],
        ["Volume", meta.regularMarketVolume ? num(meta.regularMarketVolume, 0) : null],
      ] });
      return out;
    }

    const common = [
      ["Previous Close", F(SD.previousClose ?? P.regularMarketPreviousClose)],
      ["Open", F(SD.open ?? P.regularMarketOpen)],
    ];
    const ranges = [
      ["Day's Range", range(SD.dayLow ?? P.regularMarketDayLow, SD.dayHigh ?? P.regularMarketDayHigh)],
      ["52 Week Range", range(SD.fiftyTwoWeekLow, SD.fiftyTwoWeekHigh)],
    ];
    const bidask = [["Bid", bidAsk(SD.bid, SD.bidSize)], ["Ask", bidAsk(SD.ask, SD.askSize)]];
    const volume = [
      ["Volume", L(SD.volume ?? P.regularMarketVolume)],
      ["Avg. Volume", L(SD.averageVolume ?? P.averageDailyVolume3Month)],
    ];

    if (type === "CRYPTOCURRENCY") {
      out.push({ title: "Summary", optional: true, rows: [
        ...common, ...ranges,
        ["Start Date", F(SD.startDate)],
        ["Algorithm", F(SD.algorithm)],
        ["Market Cap", cap(SD.marketCap ?? P.marketCap)],
        ["Circulating Supply", F(SD.circulatingSupply)],
        ["Max Supply", F(SD.maxSupply)],
        ["Volume", F(SD.volume)],
        ["Volume (24hr)", F(SD.volume24Hr)],
        ["Volume (24hr) All Currencies", F(SD.volumeAllCurrencies)],
        ["Fully Diluted Value", F(SD.fullyDilutedValue)],
        ["All-Time High", F(SD.allTimeHigh)],
      ] });
      const b = this.bin;
      if (b) {
        const fp = (v) => formatPrice(+v, "crypto", this.m.sym);
        const [base, quote] = this.m.sym.split("/");
        out.push({ title: `On Binance · ${this.m.sym} · 24h`, rows: [
          ["Last Price", fp(b.lastPrice)],
          ["Change", `${signed(+b.priceChange, +b.lastPrice >= 1 ? 2 : 6)} (${signed(+b.priceChangePercent)}%)`],
          ["24h Range", `${fp(b.lowPrice)} - ${fp(b.highPrice)}`],
          ["Avg. Price (VWAP)", fp(b.weightedAvgPrice)],
          ["Bid", fp(b.bidPrice)], ["Ask", fp(b.askPrice)],
          [`Volume (${base})`, big(+b.volume)],
          [`Volume (${quote})`, big(+b.quoteVolume)],
          ["Trades", num(+b.count, 0)],
        ] });
      }
    } else if (type === "CURRENCY") {
      out.push({ title: "Summary", rows: [
        ...common, ...bidask, ...ranges,
        ["50-Day Average", F(SD.fiftyDayAverage)],
        ["200-Day Average", F(SD.twoHundredDayAverage)],
        ["All-Time High", F(SD.allTimeHigh)],
        ["All-Time Low", F(SD.allTimeLow)],
      ] });
    } else if (type === "ETF" || type === "MUTUALFUND") {
      const er = FP.feesExpensesInvestment?.annualReportExpenseRatio ?? KS.annualReportExpenseRatio;
      out.push({ title: "Summary", rows: [
        ...common, ...bidask, ...ranges, ...volume,
        ["Net Assets", cap(SD.totalAssets ?? KS.totalAssets)],
        ["NAV", F(SD.navPrice)],
        ["PE Ratio (TTM)", F(SD.trailingPE)],
        ["Yield", F(SD.yield ?? KS.yield)],
        ["YTD Daily Total Return", F(KS.ytdReturn)],
        ["Beta (5Y Monthly)", F(KS.beta3Year ?? SD.beta)],
        ["Expense Ratio (net)", F(er)],
        ["Inception Date", F(KS.fundInceptionDate)],
      ] });
      out.push({ title: "Performance", optional: true, rows: [
        ["3-Year Avg. Return", F(KS.threeYearAverageReturn)],
        ["5-Year Avg. Return", F(KS.fiveYearAverageReturn)],
        ["50-Day Average", F(SD.fiftyDayAverage)],
        ["200-Day Average", F(SD.twoHundredDayAverage)],
      ] });
    } else {
      const ed = CE.earnings?.earningsDate?.map(F).filter(Boolean) ?? [];
      out.push({ title: "Summary", rows: [
        ...common, ...bidask, ...ranges, ...volume,
        ["Market Cap (intraday)", cap(SD.marketCap ?? P.marketCap)],
        ["Beta (5Y Monthly)", F(SD.beta ?? KS.beta)],
        ["PE Ratio (TTM)", F(SD.trailingPE)],
        ["EPS (TTM)", F(KS.trailingEps)],
        ["Earnings Date", ed.length ? ed.join(" - ") + (CE.earnings?.isEarningsDateEstimate ? " (est.)" : "") : null],
        ["Forward Dividend & Yield", R(SD.dividendRate) ? `${F(SD.dividendRate)} (${F(SD.dividendYield) ?? DASH})` : null],
        ["Ex-Dividend Date", F(SD.exDividendDate ?? CE.exDividendDate)],
        ["1y Target Est", F(FD.targetMeanPrice)],
      ] });
      out.push({ title: "Valuation & Financials", optional: true, rows: [
        ["Forward P/E", F(SD.forwardPE ?? KS.forwardPE)],
        ["PEG Ratio", F(KS.pegRatio)],
        ["Price/Book", F(KS.priceToBook)],
        ["Price/Sales (TTM)", F(SD.priceToSalesTrailing12Months)],
        ["Enterprise Value", cap(KS.enterpriseValue)],
        ["Revenue (TTM)", F(FD.totalRevenue)],
        ["Profit Margin", F(FD.profitMargins ?? KS.profitMargins)],
        ["Return on Equity", F(FD.returnOnEquity)],
        ["Revenue Growth (YoY)", F(FD.revenueGrowth)],
        ["Total Cash", F(FD.totalCash)],
        ["Total Debt", F(FD.totalDebt)],
        ["Free Cash Flow", F(FD.freeCashflow)],
        ["Shares Outstanding", F(KS.sharesOutstanding)],
        ["Short % of Float", F(KS.shortPercentOfFloat)],
        ["Held by Institutions", F(KS.heldPercentInstitutions)],
        ["Analyst Rating", FD.recommendationKey && FD.recommendationKey !== "none"
          ? `${FD.recommendationKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}${FD.numberOfAnalystOpinions ? ` · ${F(FD.numberOfAnalystOpinions)} analysts` : ""}` : null],
      ] });
    }
    return out;
  }

  about() {
    const q = this.q ?? {};
    const AP = q.assetProfile ?? {}, FP = q.fundProfile ?? {}, KS = q.defaultKeyStatistics ?? {};
    const facts = [
      ["Sector", AP.sectorDisp ?? AP.sector],
      ["Industry", AP.industryDisp ?? AP.industry],
      ["Employees", AP.fullTimeEmployees ? num(AP.fullTimeEmployees, 0) : null],
      ["Headquarters", [AP.city, AP.state, AP.country].filter(Boolean).join(", ") || null],
      ["Fund Family", FP.family ?? KS.fundFamily],
      ["Category", FP.categoryName ?? KS.category],
      ["Legal Type", FP.legalType ?? KS.legalType],
    ].filter(([, v]) => v);
    const text = AP.longBusinessSummary ?? AP.description ?? null;
    return { facts, text, website: AP.website ?? null };
  }

  // ---- UI ------------------------------------------------------------------

  header(t, up, down) {
    const P = this.q?.price ?? {};
    const meta = this.charts["1d"]?.meta ?? {};
    const name = P.longName ?? P.shortName ?? meta.longName ?? meta.shortName ?? this.m.sym;
    const exch = P.exchangeName ?? meta.fullExchangeName;
    const cur = P.currency ?? meta.currency;
    const sub = [this.ysym, exch, cur && `Currency in ${cur}`].filter(Boolean).join(" · ");

    // Price: Yahoo's once it's here, the tile's before that.
    let price = F(P.regularMarketPrice), chg = R(P.regularMarketChange), pct = R(P.regularMarketChangePercent);
    if (price == null && this.seed.price != null) {
      price = formatPrice(this.seed.price, this.m.kind, this.m.sym);
      if (this.seed.ref) { chg = this.seed.price - this.seed.ref; pct = chg / this.seed.ref; }
    }
    const digits = Number(R(P.priceHint) ?? (this.m.kind === "fx" ? 4 : 2));
    const color = (chg ?? 0) >= 0 ? up : down;
    const state = this.m.kind === "crypto" ? "Trades 24/7" : MARKET_STATE[P.marketState] ?? "";
    const delayed = R(P.exchangeDataDelayedBy) ? `Delayed ${R(P.exchangeDataDelayedBy)} min` : P.quoteSourceName ?? "";

    // Pre/after-hours price, like Yahoo shows under the main one.
    let ext = null;
    const isPre = /^PRE/.test(P.marketState ?? "");
    const xp = isPre ? P.preMarketPrice : P.postMarketPrice;
    if (R(xp) && this.m.kind === "stock" && P.marketState !== "REGULAR") {
      const xc = R(isPre ? P.preMarketChange : P.postMarketChange), xpct = R(isPre ? P.preMarketChangePercent : P.postMarketChangePercent);
      ext = h_flex().gap(8).items_baseline()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child(F(xp)))
        .child(div().text_size(12).text_color(xc >= 0 ? up : down).child(`${signed(xc, digits)} (${signed(xpct * 100, 2).replace(/(.dd)d+/, "$1")}%)`))
        .child(div().text_size(11).text_color(t.dim).child(isPre ? "Pre-market" : "After hours"));
    }

    return v_flex().gap(4)
      .child(h_flex().items_start().justify_between().gap(12)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(17).font_semibold().text_color(t.foreground).child(name))
          .child(div().text_size(11.5).text_color(t.muted).child(sub)))
        .child(h_flex().id("close").w(26).h(26).flex_shrink_0().rounded(6).items_center().justify_center()
          .cursor_pointer().text_size(16).text_color(t.muted)
          .hover((s) => s.bg(t.raised).text_color(t.foreground))
          .on_click(() => this.close())
          .child("×")))
      .child(h_flex().mt(8).gap(10).items_baseline()
        .child(div().text_size(30).font_semibold().text_color(t.foreground).child(price ?? DASH))
        .when(chg != null, (el) => el.child(div().text_size(15).text_color(color)
          .child(`${signed(chg, digits)} (${signed(pct * 100, 2).replace(/(.dd)d+/, "$1")}%)`))))
      .when(Boolean(ext), (el) => el.child(ext))
      .child(div().text_size(11).text_color(t.dim).child([state, delayed].filter(Boolean).join(" · ")));
  }

  chartView(t, up, down, width, cx) {
    const c = this.charts[this.range];
    const tabs = h_flex().gap(2).children(RANGES.map((r) => {
      const on = r.key === this.range;
      return div().id(`rng-${r.key}`).px(8).py(3).rounded(5).cursor_pointer().text_size(11.5)
        .font_semibold().text_color(on ? t.accent_foreground ?? t.foreground : t.muted)
        .when(on, (el) => el.bg(t.accent ?? t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.raised).text_color(t.foreground)))
        .on_click((_e, cx) => { this.range = r.key; this.hover = null; this.loadChart(cx, r.key); cx.notify(); })
        .child(r.label);
    }));

    const head = (summary, color) => h_flex().justify_between().items_center()
      .child(tabs)
      .child(div().text_size(11.5).text_color(color).child(summary));
    if (!c || c.closes.length < 2) {
      return v_flex().gap(8).child(head("", t.muted))
        .child(h_flex().h(CHART_H).items_center().justify_center().text_size(11.5).text_color(t.dim)
          .child(this.chartErr || "Loading chart…"));
    }

    const vals = c.closes;
    const stock1d = this.range === "1d" && this.m.kind === "stock";
    const base = stock1d ? (c.meta.chartPreviousClose ?? c.meta.previousClose ?? vals[0]) : vals[0];
    const last = vals.at(-1);
    const color = last >= base ? up : down;
    const fp = (v) => formatPrice(v, this.m.kind, this.m.sym);
    const pct = (v) => `${signed(((v - base) / base) * 100, 2).replace(/(.dd)d+/, "$1")}%`;
    const summary = `${pct(last)} ${this.range === "1d" ? (this.m.kind === "stock" ? "today" : "in 24h")
      : `over ${RANGES.find((r) => r.key === this.range).label}`}`;

    // One bar per point, or per bucket when there are more points than fit. Bars fill the width,
    // so bar i spans [i/N, (i+1)/N] of the plot, which is what the pointer maps back to.
    // The price axis is as wide as its longest label (tiny coins have long ones).
    const AXIS_W = Math.max(64, 22 + 6.4 * Math.max(...[...vals.slice(-1), Math.max(...vals)].map((v) => fp(v).length)));
    const plotW = Math.max(60, width - AXIS_W);
    const n = Math.max(8, Math.floor((plotW + BAR_GAP) / (BAR_W + BAR_GAP)));
    const idx = vals.length <= n ? vals.map((_, i) => i)
      : Array.from({ length: n }, (_, i) => Math.min(vals.length - 1, Math.floor(((i + 1) * vals.length) / n) - 1));
    const N = idx.length;
    const pts = idx.map((i) => vals[i]);

    // y domain: the data (and the previous close on a stock's 1D), padded so the lowest bar shows.
    let lo = Math.min(...pts), hi = Math.max(...pts);
    if (stock1d) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
    const span = hi - lo || Math.abs(hi) * 0.01 || 1;
    const dlo = lo - span * 0.1, dhi = hi + span * 0.06;
    const y = (v) => (1 - (v - dlo) / (dhi - dlo)) * CHART_H;   // px from the top
    const { ticks, decimals } = niceTicks(lo, hi, 5);

    const hov = this.hover != null && this.hover < N ? this.hover : null;
    const hv = hov != null ? pts[hov] : null;
    const xPct = (i) => ((i + 0.5) / N) * 100;

    const layers = [];
    for (const v of ticks) layers.push(div().absolute().left(0).right(0).top(y(v)).h(1).bg(t.border).opacity(0.6));
    layers.push(h_flex().absolute().inset_0().items_end().gap(BAR_GAP).children(pts.map((v, i) =>
      div().id(`b${i}`).flex_1().min_w(1).h(Math.max(2, CHART_H - y(v))).rounded(1).bg(color)
        .opacity(hov == null ? 0.8 : i === hov ? 1 : 0.45))));
    // Previous close, dashed (drawn as dashes: a 0-height dashed border doesn't paint).
    if (stock1d) layers.push(h_flex().absolute().left(0).right(0).top(y(base)).h(1).gap(3).overflow_hidden()
      .children(Array.from({ length: Math.ceil(plotW / 7) }, () => div().w(4).h(1).flex_shrink_0().bg(t.foreground).opacity(0.55))));
    if (hov != null) {
      const x = xPct(hov);
      layers.push(div().absolute().top(0).bottom(0).left(`${x}%`).w(1).bg(t.foreground).opacity(0.7));
      layers.push(div().absolute().left(0).right(0).top(y(hv)).h(1).bg(t.foreground).opacity(0.35));
      const tip = v_flex().px(8).py(5).gap(1).rounded(6).border_1().border_color(t.border).bg(t.raised ?? t.popover)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(fp(hv)))
        .child(div().text_size(11).text_color(hv >= base ? up : down)
          .child(`${signed(hv - base, decimalsOf(hv))} (${pct(hv)})`))
        .child(div().text_size(10.5).text_color(t.muted).child(this.when(c.times[idx[hov]])));
      // Beside the line, on whichever side has room.
      layers.push(x < 60
        ? div().absolute().top(2).left(`${x}%`).child(tip.ml(8))
        : div().absolute().top(2).right(`${100 - x}%`).child(tip.mr(8)));
    }

    const plotEl = div().id("plot").relative().flex_1().min_w(0).h(CHART_H)
      .on_mouse_move((e, cx) => {
        const w = e.bounds?.width;
        if (!w) return;
        const i = Math.max(0, Math.min(N - 1, Math.floor((e.local_position.x / w) * N)));
        if (i !== this.hover) { this.hover = i; cx.notify(); }
      })
      .on_hover((h, cx) => { if (!h && this.hover != null) { this.hover = null; cx.notify(); } })
      .children(layers);

    // Price axis: round-number ticks, plus a pill for the last price (or the hovered one), like Yahoo.
    const pill = (v, bg, fg) => div().absolute().left(4).top(y(v) - 9).px(5).py(1).rounded(4).bg(bg)
      .text_size(10.5).font_semibold().text_color(fg).whitespace_nowrap().child(fp(v));
    const axis = div().relative().w(AXIS_W).h(CHART_H).flex_shrink_0()
      .children(ticks.map((v) => div().absolute().left(8).top(y(v) - 7).text_size(10.5).text_color(t.dim).whitespace_nowrap()
        .child(num(v, decimals))))
      .child(hov != null ? pill(hv, t.foreground, t.background) : pill(last, color, t.background));

    const labels = h_flex().mr(AXIS_W).justify_between().text_size(10.5).text_color(t.dim)
      .child(div().child(this.when(c.times[0])))
      .child(div().child(`Low ${fp(Math.min(...vals))} · High ${fp(Math.max(...vals))}`
        + (stock1d ? ` · Prev close ${fp(base)} (dashed)` : "")))
      .child(div().child(this.when(c.times.at(-1))));

    return v_flex().gap(8)
      .child(head(summary, color))
      .child(h_flex().items_start().child(plotEl).child(axis))
      .child(labels);
  }

  /** A chart point's time, in local time: with the clock for intraday ranges. */
  when(s) {
    if (!s) return "";
    const d = new Date(s * 1000);
    const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    if (this.range === "1d" || this.range === "5d" || this.range === "1mo")
      return `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${day}, ${d.getFullYear()}`;
  }

  /** Two columns of label/value rows, ruled like Yahoo's summary table. */
  table(t, rows, wide) {
    const cell = ([label, value], i) => h_flex().id(`r-${label}-${i}`).py(6).gap(10).justify_between().items_center()
      .border_b(1).border_color(t.border)
      .child(div().text_size(11.5).text_color(t.muted).flex_shrink_0().child(label))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).text_right().min_w(0).truncate().child(value ?? DASH));
    if (!wide) return v_flex().children(rows.map(cell));
    const half = Math.ceil(rows.length / 2);
    return h_flex().gap(24).items_start()
      .child(v_flex().flex_1().min_w(0).children(rows.slice(0, half).map(cell)))
      .child(v_flex().flex_1().min_w(0).children(rows.slice(half).map((r, i) => cell(r, i + half))));
  }

  render(cx) {
    const t = theme();
    const up = t.ansi2, down = t.ansi1;
    const zoom = Number(settings()?.zoom) || 1;
    const inner = Math.max(200, (this.width ?? 640 * zoom) / zoom - 48);
    const wide = inner >= 460;

    const heading = (text) => div().mt(18).mb(4).text_size(12.5).font_semibold().text_color(t.foreground).child(text);
    const body = [this.header(t, up, down), div().h(16), this.chartView(t, up, down, inner, cx)];

    for (const s of this.sections()) {
      const rows = s.optional ? s.rows.filter(([, v]) => v) : s.rows;
      if (!rows.length) continue;
      body.push(heading(s.title), this.table(t, rows, wide));
    }
    if (!this.q && this.qErr) {
      body.push(div().mt(14).text_size(11).text_color(t.dim)
        .child(`Full details unavailable (${this.qErr}). Showing the basics.`));
    } else if (!this.q) {
      body.push(div().mt(18).text_size(11.5).text_color(t.dim).child("Loading details…"));
    }

    const a = this.about();
    if (a.facts.length || a.text) {
      body.push(heading("About"));
      if (a.facts.length) body.push(this.table(t, a.facts, wide));
      if (a.text) {
        const long = a.text.length > 420;
        const shown = long && !this.more ? a.text.slice(0, 420).replace(/\s+\S*$/, "") + "…" : a.text;
        body.push(div().mt(10).text_size(12).text_color(t.muted).whitespace_normal().child(shown));
        if (long) body.push(div().id("more").mt(4).text_size(11.5).text_color(t.accent ?? t.foreground).cursor_pointer()
          .hover((s) => s.underline())
          .on_click((_e, cx) => { this.more = !this.more; cx.notify(); })
          .child(this.more ? "Show less" : "Show more"));
      }
      if (a.website) body.push(div().id("site").mt(8).text_size(11.5).text_color(t.accent ?? t.foreground).cursor_pointer()
        .hover((s) => s.underline())
        .on_click((_e, cx) => cx.open_url(a.website))
        .child(a.website));
    }

    const footer = h_flex().px(24).py(9).items_center().justify_between().border_t(1).border_color(t.border)
      .child(div().text_size(10.5).text_color(t.dim).child("Data: Yahoo Finance" + (this.m.kind === "crypto" ? " · Binance" : "")))
      .child(h_flex().id("yahoo").px(8).py(3).rounded(5).cursor_pointer().text_size(11).text_color(t.muted)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => cx.open_url(quotePage(this.ysym)))
        .child("Open in Yahoo Finance ↗"));

    return v_flex().id("market-detail").size_full().bg(t.popover ?? t.chrome).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(v_flex().id("detail-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(24).pt(18).pb(20).children(body)))
      .child(footer);
  }
}
