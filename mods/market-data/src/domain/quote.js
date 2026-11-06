// Yahoo quoteSummary → what the popup shows: the header, the stat sections for the kind of quote
// (stock, ETF/fund, crypto, currency) and About. Plain data; the ui layer draws it.
import { yahooSymbol } from "./markets.js";
import { formatPrice, num, big, signed, percent, yFmt, yLong, yRaw, yRange, yBidAsk, yCap, DASH } from "./format.js";

/** @typedef {import("./markets.js").Market} Market */
/** @typedef {import("./format.js").YahooValue} YahooValue */
/**
 * A quoteSummary result: `{ price, summaryDetail, defaultKeyStatistics, calendarEvents,
 * financialData, assetProfile, fundProfile }`; the modules a quote type lacks are absent.
 * @typedef {Record<string, any>} QuoteSummary
 */
/**
 * Binance's /api/v3/ticker/24hr answer for one pair (numbers come as strings).
 * @typedef {{ lastPrice: string, priceChange: string, priceChangePercent: string, lowPrice: string,
 *   highPrice: string, weightedAvgPrice: string, bidPrice: string, askPrice: string, volume: string,
 *   quoteVolume: string, count: number | string }} Binance24h
 */
/** A Yahoo chart's `meta` (only the fields used here). @typedef {Record<string, any>} ChartMeta */
/** @typedef {[label: string, value: string | null]} Row */
/**
 * A titled table. `optional`: its empty rows are hidden (and the section, if nothing's left).
 * @typedef {{ title: string, optional?: boolean, rows: Row[] }} Section
 */

/** Yahoo's marketState → what the header says. */
export const MARKET_STATE = /** @type {Record<string, string>} */ ({
  REGULAR: "Market open",
  PRE: "Pre-market",
  PREPRE: "Market closed",
  POST: "After hours",
  POSTPOST: "Market closed",
  CLOSED: "Market closed",
});

/** About's text is cut at this many characters until "Show more". */
export const ABOUT_LIMIT = 420;

/**
 * The stat sections Yahoo shows for this kind of quote. Without a quoteSummary: a basic Summary
 * from the 1D chart's meta (or nothing without one either). Crypto gets Binance's 24h stats too.
 * @param {QuoteSummary | null | undefined} q
 * @param {Market} market
 * @param {{ binance24h?: Binance24h | null, chartMeta?: ChartMeta | null }} [extra]
 * @returns {Section[]}
 */
export function quoteSections(q, market, { binance24h = null, chartMeta = null } = {}) {
  /** @type {Section[]} */
  const out = [];
  if (!q) {
    // No quoteSummary (Yahoo said no, or curl is missing): what the chart's meta has.
    const meta = chartMeta;
    if (!meta) return out;
    /** @param {number | null | undefined} v */
    const fp = (v) => (v == null ? null : formatPrice(v, market.kind, market.sym));
    out.push({
      title: "Summary",
      rows: [
        ["Previous Close", fp(meta.chartPreviousClose ?? meta.previousClose)],
        [
          "Day's Range",
          meta.regularMarketDayLow != null
            ? `${fp(meta.regularMarketDayLow)} - ${fp(meta.regularMarketDayHigh)}`
            : null,
        ],
        [
          "52 Week Range",
          meta.fiftyTwoWeekLow != null ? `${fp(meta.fiftyTwoWeekLow)} - ${fp(meta.fiftyTwoWeekHigh)}` : null,
        ],
        ["Volume", meta.regularMarketVolume ? num(meta.regularMarketVolume, 0) : null],
      ],
    });
    return out;
  }

  const P = q.price ?? {},
    SD = q.summaryDetail ?? {},
    KS = q.defaultKeyStatistics ?? {};
  const CE = q.calendarEvents ?? {},
    FD = q.financialData ?? {},
    FP = q.fundProfile ?? {};
  const type =
    P.quoteType ?? (market.kind === "crypto" ? "CRYPTOCURRENCY" : market.kind === "fx" ? "CURRENCY" : "EQUITY");

  /** @type {Row[]} */
  const common = [
    ["Previous Close", yFmt(SD.previousClose ?? P.regularMarketPreviousClose)],
    ["Open", yFmt(SD.open ?? P.regularMarketOpen)],
  ];
  /** @type {Row[]} */
  const ranges = [
    ["Day's Range", yRange(SD.dayLow ?? P.regularMarketDayLow, SD.dayHigh ?? P.regularMarketDayHigh)],
    ["52 Week Range", yRange(SD.fiftyTwoWeekLow, SD.fiftyTwoWeekHigh)],
  ];
  /** @type {Row[]} */
  const bidask = [
    ["Bid", yBidAsk(SD.bid, SD.bidSize)],
    ["Ask", yBidAsk(SD.ask, SD.askSize)],
  ];
  /** @type {Row[]} */
  const volume = [
    ["Volume", yLong(SD.volume ?? P.regularMarketVolume)],
    ["Avg. Volume", yLong(SD.averageVolume ?? P.averageDailyVolume3Month)],
  ];

  if (type === "CRYPTOCURRENCY") {
    out.push({
      title: "Summary",
      optional: true,
      rows: [
        ...common,
        ...ranges,
        ["Start Date", yFmt(SD.startDate)],
        ["Algorithm", yFmt(SD.algorithm)],
        ["Market Cap", yCap(SD.marketCap ?? P.marketCap)],
        ["Circulating Supply", yFmt(SD.circulatingSupply)],
        ["Max Supply", yFmt(SD.maxSupply)],
        ["Volume", yFmt(SD.volume)],
        ["Volume (24hr)", yFmt(SD.volume24Hr)],
        ["Volume (24hr) All Currencies", yFmt(SD.volumeAllCurrencies)],
        ["Fully Diluted Value", yFmt(SD.fullyDilutedValue)],
        ["All-Time High", yFmt(SD.allTimeHigh)],
      ],
    });
    const b = binance24h;
    if (b) out.push(binanceSection(b, market.sym));
  } else if (type === "CURRENCY") {
    out.push({
      title: "Summary",
      rows: [
        ...common,
        ...bidask,
        ...ranges,
        ["50-Day Average", yFmt(SD.fiftyDayAverage)],
        ["200-Day Average", yFmt(SD.twoHundredDayAverage)],
        ["All-Time High", yFmt(SD.allTimeHigh)],
        ["All-Time Low", yFmt(SD.allTimeLow)],
      ],
    });
  } else if (type === "ETF" || type === "MUTUALFUND") {
    const er = FP.feesExpensesInvestment?.annualReportExpenseRatio ?? KS.annualReportExpenseRatio;
    out.push({
      title: "Summary",
      rows: [
        ...common,
        ...bidask,
        ...ranges,
        ...volume,
        ["Net Assets", yCap(SD.totalAssets ?? KS.totalAssets)],
        ["NAV", yFmt(SD.navPrice)],
        ["PE Ratio (TTM)", yFmt(SD.trailingPE)],
        ["Yield", yFmt(SD.yield ?? KS.yield)],
        ["YTD Daily Total Return", yFmt(KS.ytdReturn)],
        ["Beta (5Y Monthly)", yFmt(KS.beta3Year ?? SD.beta)],
        ["Expense Ratio (net)", yFmt(er)],
        ["Inception Date", yFmt(KS.fundInceptionDate)],
      ],
    });
    out.push({
      title: "Performance",
      optional: true,
      rows: [
        ["3-Year Avg. Return", yFmt(KS.threeYearAverageReturn)],
        ["5-Year Avg. Return", yFmt(KS.fiveYearAverageReturn)],
        ["50-Day Average", yFmt(SD.fiftyDayAverage)],
        ["200-Day Average", yFmt(SD.twoHundredDayAverage)],
      ],
    });
  } else {
    /** @type {string[]} */
    const ed = CE.earnings?.earningsDate?.map(yFmt).filter(Boolean) ?? [];
    out.push({
      title: "Summary",
      rows: [
        ...common,
        ...bidask,
        ...ranges,
        ...volume,
        ["Market Cap (intraday)", yCap(SD.marketCap ?? P.marketCap)],
        ["Beta (5Y Monthly)", yFmt(SD.beta ?? KS.beta)],
        ["PE Ratio (TTM)", yFmt(SD.trailingPE)],
        ["EPS (TTM)", yFmt(KS.trailingEps)],
        ["Earnings Date", ed.length ? ed.join(" - ") + (CE.earnings?.isEarningsDateEstimate ? " (est.)" : "") : null],
        [
          "Forward Dividend & Yield",
          yRaw(SD.dividendRate) ? `${yFmt(SD.dividendRate)} (${yFmt(SD.dividendYield) ?? DASH})` : null,
        ],
        ["Ex-Dividend Date", yFmt(SD.exDividendDate ?? CE.exDividendDate)],
        ["1y Target Est", yFmt(FD.targetMeanPrice)],
      ],
    });
    out.push({
      title: "Valuation & Financials",
      optional: true,
      rows: [
        ["Forward P/E", yFmt(SD.forwardPE ?? KS.forwardPE)],
        ["PEG Ratio", yFmt(KS.pegRatio)],
        ["Price/Book", yFmt(KS.priceToBook)],
        ["Price/Sales (TTM)", yFmt(SD.priceToSalesTrailing12Months)],
        ["Enterprise Value", yCap(KS.enterpriseValue)],
        ["Revenue (TTM)", yFmt(FD.totalRevenue)],
        ["Profit Margin", yFmt(FD.profitMargins ?? KS.profitMargins)],
        ["Return on Equity", yFmt(FD.returnOnEquity)],
        ["Revenue Growth (YoY)", yFmt(FD.revenueGrowth)],
        ["Total Cash", yFmt(FD.totalCash)],
        ["Total Debt", yFmt(FD.totalDebt)],
        ["Free Cash Flow", yFmt(FD.freeCashflow)],
        ["Shares Outstanding", yFmt(KS.sharesOutstanding)],
        ["Short % of Float", yFmt(KS.shortPercentOfFloat)],
        ["Held by Institutions", yFmt(KS.heldPercentInstitutions)],
        ["Analyst Rating", analystRating(FD)],
      ],
    });
  }
  return out;
}

/**
 * "Strong Buy · 40 analysts" from financialData; null when Yahoo has no rating.
 * @param {Record<string, any>} FD
 * @returns {string | null}
 */
function analystRating(FD) {
  if (!FD.recommendationKey || FD.recommendationKey === "none") return null;
  const key = FD.recommendationKey.replace(/_/g, " ").replace(/\b\w/g, (/** @type {string} */ c) => c.toUpperCase());
  return `${key}${FD.numberOfAnalystOpinions ? ` · ${yFmt(FD.numberOfAnalystOpinions)} analysts` : ""}`;
}

/**
 * The pair's own 24h stats on Binance.
 * @param {Binance24h} b
 * @param {string} sym "BTC/USDT"
 * @returns {Section}
 */
function binanceSection(b, sym) {
  /** @param {string | number} v */
  const fp = (v) => formatPrice(+v, "crypto", sym);
  const [base, quote] = sym.split("/");
  return {
    title: `On Binance · ${sym} · 24h`,
    rows: [
      ["Last Price", fp(b.lastPrice)],
      ["Change", `${signed(+b.priceChange, +b.lastPrice >= 1 ? 2 : 6)} (${signed(+b.priceChangePercent)}%)`],
      ["24h Range", `${fp(b.lowPrice)} - ${fp(b.highPrice)}`],
      ["Avg. Price (VWAP)", fp(b.weightedAvgPrice)],
      ["Bid", fp(b.bidPrice)],
      ["Ask", fp(b.askPrice)],
      [`Volume (${base})`, big(+b.volume)],
      [`Volume (${quote})`, big(+b.quoteVolume)],
      ["Trades", num(+b.count, 0)],
    ],
  };
}

/**
 * The sections as drawn: an optional section's empty rows are dropped, and a section left with no
 * rows is skipped.
 * @param {Section[]} sections
 * @returns {Section[]}
 */
export function visibleSections(sections) {
  /** @type {Section[]} */
  const out = [];
  for (const s of sections) {
    const rows = s.optional ? s.rows.filter(([, v]) => v) : s.rows;
    if (rows.length) out.push({ ...s, rows });
  }
  return out;
}

/**
 * About: profile facts (sector, industry, employees, HQ; fund family, category, legal type), the
 * business summary and the website. Facts without a value are left out.
 * @param {QuoteSummary | null | undefined} q
 * @returns {{ facts: [string, string][], text: string | null, website: string | null }}
 */
export function quoteAbout(q) {
  const s = q ?? {};
  const AP = s.assetProfile ?? {},
    FP = s.fundProfile ?? {},
    KS = s.defaultKeyStatistics ?? {};
  const facts = /** @type {[string, string][]} */ (
    [
      ["Sector", AP.sectorDisp ?? AP.sector],
      ["Industry", AP.industryDisp ?? AP.industry],
      ["Employees", AP.fullTimeEmployees ? num(AP.fullTimeEmployees, 0) : null],
      ["Headquarters", [AP.city, AP.state, AP.country].filter(Boolean).join(", ") || null],
      ["Fund Family", FP.family ?? KS.fundFamily],
      ["Category", FP.categoryName ?? KS.category],
      ["Legal Type", FP.legalType ?? KS.legalType],
    ].filter(([, v]) => v)
  );
  const text = AP.longBusinessSummary ?? AP.description ?? null;
  return { facts, text, website: AP.website ?? null };
}

/**
 * About's text as shown: cut at a word before `limit` characters with "…" unless expanded.
 * @param {string} text
 * @param {boolean} expanded
 * @param {number} [limit]
 * @returns {{ shown: string, long: boolean }} long: whether a "Show more/less" toggle is needed
 */
export function aboutText(text, expanded, limit = ABOUT_LIMIT) {
  const long = text.length > limit;
  const shown = long && !expanded ? text.slice(0, limit).replace(/\s+\S*$/, "") + "…" : text;
  return { shown, long };
}

/**
 * @typedef {{
 *   price: string | null, change: number | null, pct: number | null,
 *   changeText: string, up: boolean, label: string
 * }} ExtendedHours
 */
/**
 * @typedef {{
 *   name: string, sub: string, price: string | null, change: number | null, pct: number | null,
 *   changeText: string | null, up: boolean, digits: number, state: string, delayed: string,
 *   status: string, ext: ExtendedHours | null
 * }} QuoteHeader
 */

/**
 * The popup's header: name, "AAPL · NasdaqGS · Currency in USD", the price and change (Yahoo's
 * once it's here, the tile's `seed` before that), market state, delay, and the pre-market or
 * after-hours price for stocks outside regular hours. `pct` is a fraction (0.0123 = 1.23%).
 * @param {QuoteSummary | null | undefined} q
 * @param {Market} market
 * @param {{ seed?: { price?: number | null, ref?: number | null } | null, chartMeta?: ChartMeta | null }} [extra]
 * @returns {QuoteHeader}
 */
export function quoteHeader(q, market, { seed = null, chartMeta = null } = {}) {
  const P = q?.price ?? {};
  const meta = chartMeta ?? {};
  const name = P.longName ?? P.shortName ?? meta.longName ?? meta.shortName ?? market.sym;
  const exch = P.exchangeName ?? meta.fullExchangeName;
  const cur = P.currency ?? meta.currency;
  const sub = [yahooSymbol(market), exch, cur && `Currency in ${cur}`].filter(Boolean).join(" · ");

  let price = yFmt(P.regularMarketPrice),
    change = yRaw(P.regularMarketChange),
    pct = yRaw(P.regularMarketChangePercent);
  if (price == null && seed?.price != null) {
    price = formatPrice(seed.price, market.kind, market.sym);
    if (seed.ref) {
      change = seed.price - seed.ref;
      pct = change / seed.ref;
    }
  }
  const digits = Number(yRaw(P.priceHint) ?? (market.kind === "fx" ? 4 : 2));
  const state = market.kind === "crypto" ? "Trades 24/7" : (MARKET_STATE[P.marketState] ?? "");
  const delay = yRaw(P.exchangeDataDelayedBy);
  const delayed = delay ? `Delayed ${delay} min` : (P.quoteSourceName ?? "");

  /** @type {ExtendedHours | null} */
  let ext = null;
  const isPre = /^PRE/.test(P.marketState ?? "");
  const xp = isPre ? P.preMarketPrice : P.postMarketPrice;
  if (yRaw(xp) && market.kind === "stock" && P.marketState !== "REGULAR") {
    const xc = yRaw(isPre ? P.preMarketChange : P.postMarketChange),
      xpct = yRaw(isPre ? P.preMarketChangePercent : P.postMarketChangePercent);
    ext = {
      price: yFmt(xp),
      change: xc,
      pct: xpct,
      changeText: `${signed(xc, digits)} (${percent(xpct * 100)}%)`,
      up: xc >= 0,
      label: isPre ? "Pre-market" : "After hours",
    };
  }

  return {
    name,
    sub,
    price,
    change,
    pct,
    changeText: change != null ? `${signed(change, digits)} (${percent(pct * 100)}%)` : null,
    up: (change ?? 0) >= 0,
    digits,
    state,
    delayed,
    status: [state, delayed].filter(Boolean).join(" · "),
    ext,
  };
}
