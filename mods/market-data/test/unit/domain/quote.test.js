import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MARKET_STATE,
  ABOUT_LIMIT,
  quoteSections,
  visibleSections,
  quoteAbout,
  aboutText,
  quoteHeader,
} from "../../../src/domain/quote.js";

// Real quoteSummary results (json.quoteSummary.result[0]), recorded once; companyOfficers dropped.
const load = (sym) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/yahoo/quoteSummary-${sym}.json`, import.meta.url), "utf8"));
const AAPL = load("AAPL");
const BRKB = load("BRK-B");
const SPY = load("SPY");
const BTC = load("BTC-USD");
const PEPE = load("PEPE24478-USD");
const EURUSD = load("EURUSDX");

const M = {
  AAPL: { id: "stock:AAPL", kind: "stock", sym: "AAPL" },
  BRKB: { id: "stock:BRK.B", kind: "stock", sym: "BRK.B" },
  SPY: { id: "stock:SPY", kind: "stock", sym: "SPY" },
  BTC: { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" },
  PEPE: { id: "crypto:PEPE/USDT", kind: "crypto", sym: "PEPE/USDT", ysym: "PEPE24478-USD" },
  EURUSD: { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" },
};

/** A section's rows as an object, for picking values out. */
const rowsOf = (section) => Object.fromEntries(section.rows);
const titles = (sections) => sections.map((s) => s.title);

const BINANCE_BTC = {
  symbol: "BTCUSDT",
  lastPrice: "75973.31000000",
  priceChange: "-4522.68000000",
  priceChangePercent: "-5.618",
  lowPrice: "75000.00000000",
  highPrice: "81000.00000000",
  weightedAvgPrice: "78000.50000000",
  bidPrice: "75973.30000000",
  askPrice: "75973.31000000",
  volume: "25000.12345000",
  quoteVolume: "1950000000.50000000",
  count: 3456789,
};
const BINANCE_PEPE = {
  ...BINANCE_BTC,
  lastPrice: "0.00000491",
  priceChange: "-0.00000009",
  priceChangePercent: "-1.800",
  lowPrice: "0.00000480",
  highPrice: "0.00000510",
  weightedAvgPrice: "0.00000495",
  bidPrice: "0.00000490",
  askPrice: "0.00000491",
  volume: "4500000000000.00",
  quoteVolume: "22000000.00",
  count: "123456",
};

describe("quoteSections: stocks (EQUITY)", () => {
  const sections = quoteSections(AAPL, M.AAPL);
  const [summary, valuation] = sections;
  const s = rowsOf(summary);
  const v = rowsOf(valuation);

  it("has Summary and an optional Valuation & Financials", () => {
    expect(titles(sections)).toEqual(["Summary", "Valuation & Financials"]);
    expect(summary.optional).toBeUndefined();
    expect(valuation.optional).toBe(true);
    expect(summary.rows.map(([l]) => l)).toEqual([
      "Previous Close",
      "Open",
      "Bid",
      "Ask",
      "Day's Range",
      "52 Week Range",
      "Volume",
      "Avg. Volume",
      "Market Cap (intraday)",
      "Beta (5Y Monthly)",
      "PE Ratio (TTM)",
      "EPS (TTM)",
      "Earnings Date",
      "Forward Dividend & Yield",
      "Ex-Dividend Date",
      "1y Target Est",
    ]);
  });

  it("uses Yahoo's formatting", () => {
    expect(s["Previous Close"]).toBe("349.51");
    expect(s.Open).toBe("353.89");
    expect(s.Bid).toBe("344.02 x 300");
    expect(s.Ask).toBe("350.00 x 500");
    expect(s["Day's Range"]).toBe("342.06 - 355.38");
    expect(s["52 Week Range"]).toBe("243.42 - 355.38");
    expect(s.Volume).toBe("74,173,346");
    expect(s["Avg. Volume"]).toBe("42,258,960");
    expect(s["Beta (5Y Monthly)"]).toBe("1.09");
    expect(s["PE Ratio (TTM)"]).toBe("38.33");
    expect(s["EPS (TTM)"]).toBe(AAPL.defaultKeyStatistics.trailingEps.fmt);
    expect(s["1y Target Est"]).toBe("333.28");
  });

  it("keeps two decimals on market caps where Yahoo says 5T", () => {
    expect(AAPL.summaryDetail.marketCap.fmt).toBe("5T");
    expect(s["Market Cap (intraday)"]).toBe("5.00T");
    expect(v["Enterprise Value"]).toBe("5.04T");
  });

  it("shows earnings, dividends and the analysts", () => {
    expect(s["Earnings Date"]).toBe("2027-01-28 (est.)");
    expect(s["Forward Dividend & Yield"]).toBe("1.08 (0.31%)");
    expect(s["Ex-Dividend Date"]).toBe("2026-11-12");
    expect(v["Analyst Rating"]).toBe("Buy · 38 analysts");
    expect(v["Revenue (TTM)"]).toBe(AAPL.financialData.totalRevenue.fmt);
    expect(v["Profit Margin"]).toBe(AAPL.financialData.profitMargins.fmt);
  });

  it("handles a stock without a dividend (BRK-B)", () => {
    const [sum, val] = quoteSections(BRKB, M.BRKB);
    const b = rowsOf(sum);
    expect(b["Forward Dividend & Yield"]).toBeNull();
    expect(b["Ex-Dividend Date"]).toBeNull();
    expect(b["Earnings Date"]).toBe("2026-11-07");
    expect(b.Bid).toBe("569.72 x 4,000");
    expect(rowsOf(val)["Enterprise Value"]).toBe("-233.83B");
  });

  it("falls back across modules and formats ratings", () => {
    const q = {
      price: {
        quoteType: "EQUITY",
        regularMarketPreviousClose: { raw: 10, fmt: "10.00" },
        regularMarketOpen: { raw: 11, fmt: "11.00" },
        regularMarketDayLow: { raw: 9, fmt: "9.00" },
        regularMarketDayHigh: { raw: 12, fmt: "12.00" },
        regularMarketVolume: { raw: 1000, fmt: "1k", longFmt: "1,000" },
        averageDailyVolume3Month: { raw: 2000, fmt: "2k" },
        marketCap: { raw: 1.5e9, fmt: "1.5B" },
      },
      defaultKeyStatistics: { beta: { raw: 1.2, fmt: "1.20" }, forwardPE: { raw: 20, fmt: "20.00" } },
      calendarEvents: {
        exDividendDate: { raw: 1, fmt: "2026-01-01" },
        earnings: {
          earningsDate: [
            { raw: 1, fmt: "2027-01-28" },
            { raw: 2, fmt: "2027-02-01" },
          ],
        },
      },
      summaryDetail: { dividendRate: { raw: 0.5, fmt: "0.50" } },
      financialData: { recommendationKey: "strong_buy", profitMargins: { raw: 0.1, fmt: "10.00%" } },
    };
    const [sum, val] = quoteSections(q, M.AAPL);
    expect(rowsOf(sum)).toMatchObject({
      "Previous Close": "10.00",
      Open: "11.00",
      "Day's Range": "9.00 - 12.00",
      "52 Week Range": null,
      Bid: null,
      Volume: "1,000",
      "Avg. Volume": "2k",
      "Market Cap (intraday)": "1.50B",
      "Beta (5Y Monthly)": "1.20",
      "Earnings Date": "2027-01-28 - 2027-02-01",
      "Forward Dividend & Yield": "0.50 (--)",
      "Ex-Dividend Date": "2026-01-01",
    });
    expect(rowsOf(val)).toMatchObject({
      "Forward P/E": "20.00",
      "Profit Margin": "10.00%",
      "Analyst Rating": "Strong Buy",
    });
    const none = quoteSections({ financialData: { recommendationKey: "none" } }, M.AAPL);
    expect(rowsOf(none[1])["Analyst Rating"]).toBeNull();
  });

  it("treats an unknown quote type like a stock", () => {
    expect(titles(quoteSections({ price: { quoteType: "INDEX" } }, M.AAPL))).toEqual([
      "Summary",
      "Valuation & Financials",
    ]);
  });
});

describe("quoteSections: ETFs", () => {
  const sections = quoteSections(SPY, M.SPY);
  const s = rowsOf(sections[0]);

  it("has Summary and an optional Performance", () => {
    expect(titles(sections)).toEqual(["Summary", "Performance"]);
    expect(sections[1].optional).toBe(true);
  });

  it("shows fund numbers", () => {
    expect(s["Net Assets"]).toBe("796.87B");
    expect(s.NAV).toBe("766.43");
    expect(s["PE Ratio (TTM)"]).toBe("23.32");
    expect(s.Yield).toBe("1.00%");
    expect(s["YTD Daily Total Return"]).toBe("13.33%");
    expect(s["Beta (5Y Monthly)"]).toBe("0.97");
    expect(s["Expense Ratio (net)"]).toBe("0.09%");
    expect(s.Bid).toBe("734.40 x 8,000");
    expect(rowsOf(sections[1])["50-Day Average"]).toBe(SPY.summaryDetail.fiftyDayAverage.fmt);
  });

  it("falls back to key statistics, and treats mutual funds the same", () => {
    const q = {
      price: { quoteType: "MUTUALFUND" },
      summaryDetail: { beta: { raw: 1, fmt: "1.00" } },
      defaultKeyStatistics: {
        annualReportExpenseRatio: { raw: 0.002, fmt: "0.20%" },
        totalAssets: { raw: 2e9, fmt: "2B" },
        yield: { raw: 0.02, fmt: "2.00%" },
      },
    };
    const [sum] = quoteSections(q, M.SPY);
    expect(rowsOf(sum)).toMatchObject({
      "Expense Ratio (net)": "0.20%",
      "Net Assets": "2.00B",
      Yield: "2.00%",
      "Beta (5Y Monthly)": "1.00",
    });
  });
});

describe("quoteSections: crypto", () => {
  it("has an optional Summary", () => {
    const sections = quoteSections(BTC, M.BTC);
    expect(titles(sections)).toEqual(["Summary"]);
    expect(sections[0].optional).toBe(true);
    const s = rowsOf(sections[0]);
    expect(s["Previous Close"]).toBe("75,982.81");
    expect(s["Market Cap"]).toBe("1.53T");
    expect(s["Day's Range"]).toBe("75,861.16 - 76,282.40");
    expect(s.Volume).toBe("48.59B");
    expect(s["Circulating Supply"]).toBe(BTC.summaryDetail.circulatingSupply.fmt);
  });

  it("adds Binance's 24h stats", () => {
    const sections = quoteSections(BTC, M.BTC, { binance24h: BINANCE_BTC });
    expect(titles(sections)).toEqual(["Summary", "On Binance · BTC/USDT · 24h"]);
    expect(sections[1].rows).toEqual([
      ["Last Price", "75,973.31"],
      ["Change", "-4,522.68 (-5.62%)"],
      ["24h Range", "75,000.00 - 81,000.00"],
      ["Avg. Price (VWAP)", "78,000.50"],
      ["Bid", "75,973.30"],
      ["Ask", "75,973.31"],
      ["Volume (BTC)", "25.00k"],
      ["Volume (USDT)", "1.95B"],
      ["Trades", "3,456,789"],
    ]);
  });

  it("replaces Yahoo's '0.00000' for tiny coins (PEPE)", () => {
    const sections = quoteSections(PEPE, M.PEPE, { binance24h: BINANCE_PEPE });
    const s = rowsOf(sections[0]);
    expect(PEPE.summaryDetail.previousClose.fmt).toBe("0.00000");
    expect(s["Previous Close"]).toBe("0.000004782");
    expect(s.Open).toBe("0.000004782");
    expect(s["Day's Range"]).toBe("0.000004782 - 0.000004910");
    expect(s["52 Week Range"]).toBe("0.000002000 - 0.00001");
    expect(s.Algorithm).toBeNull();
    expect(s["Market Cap"]).toBe("2.02B");
    expect(s["Start Date"]).toBe("2023-04-17");
    expect(rowsOf(sections[1])).toMatchObject({
      "Last Price": "0.00000491",
      Change: "-0.00000009000 (-1.80%)",
      "24h Range": "0.00000480 - 0.00000510",
      "Volume (PEPE)": "4.50T",
      "Volume (USDT)": "22.00M",
      Trades: "123,456",
    });
  });

  it("uses the market's kind when Yahoo has no quoteType", () => {
    expect(titles(quoteSections({ summaryDetail: {} }, M.BTC))).toEqual(["Summary"]);
    expect(quoteSections({ summaryDetail: {} }, M.BTC)[0].optional).toBe(true);
  });
});

describe("quoteSections: currencies", () => {
  it("has a Summary with bid/ask and averages", () => {
    const sections = quoteSections(EURUSD, M.EURUSD);
    expect(titles(sections)).toEqual(["Summary"]);
    expect(sections[0].optional).toBeUndefined();
    expect(sections[0].rows.map(([l]) => l)).toEqual([
      "Previous Close",
      "Open",
      "Bid",
      "Ask",
      "Day's Range",
      "52 Week Range",
      "50-Day Average",
      "200-Day Average",
      "All-Time High",
      "All-Time Low",
    ]);
    const s = rowsOf(sections[0]);
    expect(s["Previous Close"]).toBe("1.1218");
    expect(s.Bid).toBe("1.1166"); // size 0: no " x 0"
    expect(s.Ask).toBe("1.1159");
  });

  it("uses the market's kind when Yahoo has no quoteType", () => {
    expect(quoteSections({}, M.EURUSD)[0].rows).toHaveLength(10);
  });
});

describe("quoteSections: without a quoteSummary", () => {
  it("is empty without the chart's meta either", () => {
    expect(quoteSections(null, M.AAPL)).toEqual([]);
    expect(quoteSections(undefined, M.AAPL, { chartMeta: null })).toEqual([]);
  });

  it("shows the basics from the 1D chart's meta", () => {
    const chartMeta = {
      chartPreviousClose: 349.51,
      previousClose: 1,
      regularMarketDayLow: 340.1,
      regularMarketDayHigh: 350.2,
      fiftyTwoWeekLow: 169.21,
      fiftyTwoWeekHigh: 360,
      regularMarketVolume: 74173346,
    };
    expect(quoteSections(null, M.AAPL, { chartMeta })).toEqual([
      {
        title: "Summary",
        rows: [
          ["Previous Close", "349.51"],
          ["Day's Range", "340.10 - 350.20"],
          ["52 Week Range", "169.21 - 360.00"],
          ["Volume", "74,173,346"],
        ],
      },
    ]);
  });

  it("formats like the tile and leaves gaps", () => {
    const [s] = quoteSections(null, M.EURUSD, { chartMeta: { previousClose: 1.1218308, regularMarketVolume: 0 } });
    expect(s.rows).toEqual([
      ["Previous Close", "1.1218"],
      ["Day's Range", null],
      ["52 Week Range", null],
      ["Volume", null],
    ]);
    const [e] = quoteSections(null, M.AAPL, { chartMeta: {} });
    expect(e.rows.every(([, v]) => v == null)).toBe(true);
  });

  it("ignores Binance without a quoteSummary", () => {
    expect(quoteSections(null, M.BTC, { binance24h: BINANCE_BTC })).toEqual([]);
  });
});

describe("visibleSections", () => {
  it("drops an optional section's empty rows, and empty sections", () => {
    const out = visibleSections([
      { title: "A", rows: [["x", null]] },
      {
        title: "B",
        optional: true,
        rows: [
          ["x", null],
          ["y", "1"],
        ],
      },
      { title: "C", optional: true, rows: [["x", null]] },
      { title: "D", rows: [] },
    ]);
    expect(out).toEqual([
      { title: "A", rows: [["x", null]] },
      { title: "B", optional: true, rows: [["y", "1"]] },
    ]);
  });

  it("leaves PEPE's summary without its missing algorithm", () => {
    const [s] = visibleSections(quoteSections(PEPE, M.PEPE));
    expect(s.rows.map(([l]) => l)).not.toContain("Algorithm");
  });
});

describe("quoteAbout", () => {
  it("collects a company's profile", () => {
    const a = quoteAbout(AAPL);
    expect(a.facts).toEqual([
      ["Sector", "Technology"],
      ["Industry", "Consumer Electronics"],
      ["Employees", "167,000"],
      ["Headquarters", "Cupertino, CA, United States"],
    ]);
    expect(a.text).toBe(AAPL.assetProfile.longBusinessSummary);
    expect(a.website).toBe("https://www.apple.com");
  });

  it("collects a fund's profile", () => {
    const a = quoteAbout(SPY);
    expect(a.facts).toEqual([
      ["Fund Family", "State Street Investment Management"],
      ["Category", "Large Blend"],
      ["Legal Type", "Exchange Traded Fund"],
    ]);
    expect(a.text).toMatch(/^The trust seeks/);
    expect(a.website).toBeNull();
  });

  it("uses a coin's description", () => {
    const a = quoteAbout(BTC);
    expect(a.facts).toEqual([]);
    expect(a.text).toBe(BTC.assetProfile.description);
    expect(a.website).toBe("https://bitcoin.org/");
  });

  it("falls back to raw fields and key statistics", () => {
    const a = quoteAbout({
      assetProfile: { sector: "Energy", industry: "Oil", country: "Canada" },
      defaultKeyStatistics: { fundFamily: "Vanguard", category: "Bonds", legalType: "ETF" },
    });
    expect(a.facts).toEqual([
      ["Sector", "Energy"],
      ["Industry", "Oil"],
      ["Headquarters", "Canada"],
      ["Fund Family", "Vanguard"],
      ["Category", "Bonds"],
      ["Legal Type", "ETF"],
    ]);
    expect(a.text).toBeNull();
  });

  it("is empty without a quoteSummary", () => {
    expect(quoteAbout(null)).toEqual({ facts: [], text: null, website: null });
    expect(quoteAbout(EURUSD)).toEqual({ facts: [], text: null, website: null });
  });
});

describe("aboutText", () => {
  it("leaves short text alone", () => {
    expect(aboutText("Short.", false)).toEqual({ shown: "Short.", long: false });
  });

  it("cuts long text at a word", () => {
    const text = AAPL.assetProfile.longBusinessSummary;
    expect(text.length).toBeGreaterThan(ABOUT_LIMIT);
    const { shown, long } = aboutText(text, false);
    expect(long).toBe(true);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(ABOUT_LIMIT + 1);
    expect(text.startsWith(shown.slice(0, -1))).toBe(true);
    expect(text[shown.length - 1]).toMatch(/\s/);
    expect(aboutText(text, true)).toEqual({ shown: text, long: true });
  });

  it("takes a limit", () => {
    expect(aboutText("one two three", false, 9)).toEqual({ shown: "one two…", long: true });
  });
});

describe("quoteHeader", () => {
  it("shows a closed stock with its after-hours price (AAPL)", () => {
    expect(quoteHeader(AAPL, M.AAPL)).toEqual({
      name: "Apple Inc.",
      sub: "AAPL · NasdaqGS · Currency in USD",
      price: "344.17",
      change: -5.34,
      pct: -0.0152785005,
      changeText: "-5.34 (-1.53%)",
      up: false,
      digits: 2,
      state: "Market closed",
      delayed: "Delayed 15 min",
      status: "Market closed · Delayed 15 min",
      ext: {
        price: "343.32",
        change: -0.84851074,
        pct: -0.0024653825,
        changeText: "-0.8485 (-0.24%)",
        up: false,
        label: "After hours",
      },
    });
  });

  it("names BRK-B with Yahoo's symbol", () => {
    const h = quoteHeader(BRKB, M.BRKB);
    expect(h.name).toBe("Berkshire Hathaway Inc.");
    expect(h.sub).toBe("BRK-B · NYSE · Currency in USD");
    expect(h.status).toBe("Market closed · Delayed 20 min");
  });

  it("shows crypto as trading 24/7, without extended hours", () => {
    const h = quoteHeader(BTC, M.BTC);
    expect(h).toMatchObject({
      name: "Bitcoin USD",
      sub: "BTC-USD · CCC · Currency in USD",
      price: "75,973.31",
      changeText: "-4,522.68 (-5.62%)",
      state: "Trades 24/7",
      delayed: "CoinMarketCap",
      status: "Trades 24/7 · CoinMarketCap",
      ext: null,
    });
  });

  it("shows a tiny price in full (PEPE)", () => {
    const h = quoteHeader(PEPE, M.PEPE);
    expect(h.price).toBe("0.000004880");
    expect(h.digits).toBe(5);
    expect(h.changeText).toBe("-0.0000001800 (-3.56%)");
    expect(h.sub).toBe("PEPE24478-USD · CCC · Currency in USD");
  });

  it("shows FX with 4 digits and no extended hours", () => {
    const h = quoteHeader(EURUSD, M.EURUSD);
    expect(h).toMatchObject({
      name: "EUR/USD",
      sub: "EURUSD=X · CCY · Currency in USD",
      price: "1.1213",
      changeText: "-0.0005032 (-0.04%)",
      digits: 4,
      state: "Market open",
      delayed: "Delayed Quote",
      ext: null,
    });
  });

  it("shows the pre-market price before the open", () => {
    const price = {
      ...AAPL.price,
      marketState: "PRE",
      preMarketPrice: { raw: 350, fmt: "350.00" },
      preMarketChange: { raw: 5.83, fmt: "5.83" },
      preMarketChangePercent: { raw: 0.01694, fmt: "1.69%" },
    };
    const h = quoteHeader({ price }, M.AAPL);
    expect(h.state).toBe("Pre-market");
    expect(h.ext).toEqual({
      price: "350.00",
      change: 5.83,
      pct: 0.01694,
      changeText: "+5.83 (+1.69%)",
      up: true,
      label: "Pre-market",
    });
    expect(quoteHeader({ price: { ...price, marketState: "PREPRE" } }, M.AAPL).ext?.label).toBe("Pre-market");
  });

  it("has no extended hours while the market is open or without a price", () => {
    expect(quoteHeader({ price: { ...AAPL.price, marketState: "REGULAR" } }, M.AAPL).ext).toBeNull();
    expect(quoteHeader({ price: { ...AAPL.price, postMarketPrice: {} } }, M.AAPL).ext).toBeNull();
    // ETFs are stocks to the tile: they get it too.
    expect(quoteHeader(SPY, M.SPY).ext?.changeText).toBe("+1.25 (+0.17%)");
  });

  it("shows +0.00% when Yahoo has an extended price but no change (reference quirk)", () => {
    const h = quoteHeader({ price: { marketState: "POST", postMarketPrice: { raw: 10, fmt: "10.00" } } }, M.AAPL);
    expect(h.ext).toEqual({
      price: "10.00",
      change: null,
      pct: null,
      changeText: " (+0.00%)",
      up: true,
      label: "After hours",
    });
  });

  it("uses the tile's price until Yahoo answers", () => {
    const h = quoteHeader(null, M.AAPL, { seed: { price: 344.17, ref: 349.51 } });
    expect(h.price).toBe("344.17");
    expect(h.change).toBeCloseTo(-5.34);
    expect(h.pct).toBeCloseTo(-5.34 / 349.51);
    expect(h.changeText).toBe("-5.34 (-1.53%)");
    expect(h.up).toBe(false);
    expect(h).toMatchObject({ name: "AAPL", sub: "AAPL", digits: 2, state: "", delayed: "", status: "", ext: null });
  });

  it("shows the seed's price without a change when it has no reference", () => {
    const h = quoteHeader(null, M.EURUSD, { seed: { price: 1.12133, ref: null } });
    expect(h).toMatchObject({ price: "1.1213", change: null, pct: null, changeText: null, up: true, digits: 4 });
  });

  it("has no price without Yahoo or a seed", () => {
    expect(quoteHeader(null, M.BTC)).toMatchObject({
      price: null,
      changeText: null,
      status: "Trades 24/7",
      sub: "BTC-USD",
    });
    expect(quoteHeader({ price: {} }, M.AAPL, { seed: { price: null, ref: 1 } }).price).toBeNull();
  });

  it("prefers Yahoo's price to the seed", () => {
    expect(quoteHeader(AAPL, M.AAPL, { seed: { price: 1, ref: 2 } }).price).toBe("344.17");
  });

  it("names the quote from the chart's meta before quoteSummary answers", () => {
    const chartMeta = { longName: "Apple Inc.", shortName: "Apple", fullExchangeName: "NasdaqGS", currency: "USD" };
    expect(quoteHeader(null, M.AAPL, { chartMeta })).toMatchObject({
      name: "Apple Inc.",
      sub: "AAPL · NasdaqGS · Currency in USD",
    });
    expect(quoteHeader(null, M.AAPL, { chartMeta: { shortName: "Apple" } }).name).toBe("Apple");
    expect(quoteHeader({ price: { shortName: "Apple Short" } }, M.AAPL).name).toBe("Apple Short");
  });

  it("labels every market state", () => {
    for (const [state, label] of Object.entries(MARKET_STATE)) {
      expect(quoteHeader({ price: { marketState: state } }, M.AAPL).state).toBe(label);
    }
    expect(quoteHeader({ price: { marketState: "WEIRD" } }, M.AAPL).state).toBe("");
  });
});
