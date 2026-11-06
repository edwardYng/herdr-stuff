import { describe, it, expect } from "vitest";
import {
  TYPE_WORDS,
  US_EXCHANGES,
  MAX_SUGGESTIONS,
  parseQuery,
  searchPlan,
  toSuggestion,
  binanceMatches,
  rankSuggestions,
  buildSuggestions,
} from "../../../src/domain/search.js";

// Yahoo /v1/finance/search hits, as Yahoo sends them (trimmed to the fields that matter).
const hit = {
  AAPL: {
    symbol: "AAPL",
    quoteType: "EQUITY",
    exchange: "NMS",
    exchDisp: "NASDAQ",
    shortname: "Apple Inc.",
    longname: "Apple Inc.",
  },
  BRKB: {
    symbol: "BRK-B",
    quoteType: "EQUITY",
    exchange: "NYQ",
    exchDisp: "NYSE",
    shortname: "Berkshire Hathaway Inc. New",
    longname: "Berkshire Hathaway Inc.",
  },
  SPY: { symbol: "SPY", quoteType: "ETF", exchange: "PCX", exchDisp: "NYSEArca", shortname: "SPDR S&P 500" },
  SHOP_TO: { symbol: "SHOP.TO", quoteType: "EQUITY", exchange: "TOR", exchDisp: "Toronto", shortname: "Shopify" },
  FSLR: { symbol: "FSLR", quoteType: "EQUITY", exchange: "NMS", exchDisp: "NASDAQ", longname: "First Solar, Inc." },
  COIN: { symbol: "COIN", quoteType: "EQUITY", exchange: "NMS", exchDisp: "NASDAQ", longname: "Coinbase Global, Inc." },
  PEP: { symbol: "PEP", quoteType: "EQUITY", exchange: "NMS", exchDisp: "NASDAQ", longname: "PepsiCo, Inc." },
  ARBE: { symbol: "ARBE", quoteType: "EQUITY", exchange: "NCM", exchDisp: "NASDAQ", longname: "Arbe Robotics Ltd." },
  BTC: { symbol: "BTC-USD", quoteType: "CRYPTOCURRENCY", exchange: "CCC", exchDisp: "CCC", shortname: "Bitcoin USD" },
  BTC_EUR: {
    symbol: "BTC-EUR",
    quoteType: "CRYPTOCURRENCY",
    exchange: "CCC",
    exchDisp: "CCC",
    shortname: "Bitcoin EUR",
  },
  SOL: { symbol: "SOL-USD", quoteType: "CRYPTOCURRENCY", exchange: "CCC", exchDisp: "CCC", shortname: "Solana USD" },
  SOL_EUR: {
    symbol: "SOL-EUR",
    quoteType: "CRYPTOCURRENCY",
    exchange: "CCC",
    exchDisp: "CCC",
    shortname: "Solana EUR",
  },
  PEPE: {
    symbol: "PEPE24478-USD",
    quoteType: "CRYPTOCURRENCY",
    exchange: "CCC",
    exchDisp: "CCC",
    shortname: "Pepe USD",
  },
  SUI: { symbol: "SUI20947-USD", quoteType: "CRYPTOCURRENCY", exchange: "CCC", exchDisp: "CCC", shortname: "Sui USD" },
  BRKB_USD: { symbol: "BRKB-USD", quoteType: "CRYPTOCURRENCY", exchange: "CCC", shortname: "Berkshire tokenized USD" },
  EURUSD: { symbol: "EURUSD=X", quoteType: "CURRENCY", exchange: "CCY", exchDisp: "CCY", shortname: "EUR/USD" },
  GOLD: { symbol: "GC=F", quoteType: "FUTURE", exchange: "CMX", shortname: "Gold" },
  SPX: { symbol: "^GSPC", quoteType: "INDEX", exchange: "SNP", shortname: "S&P 500" },
};

const stock = (sym) => ({ id: `stock:${sym}`, kind: "stock", sym });
const crypto = (sym) => ({ id: `crypto:${sym}`, kind: "crypto", sym });

describe("parseQuery", () => {
  it.each([
    ["sui crypto", "sui", "Crypto"],
    ["etf gold", "gold", "ETF"],
    ["EUR FX", "EUR", "FX"],
    ["apple shares", "apple", "Stock"],
    ["coin stock", "coin", "Stock"], // the last type word filters; "coin" is part of the name
    ["crypto coin", "crypto", "Crypto"],
    ["bitcoin cash crypto", "bitcoin cash", "Crypto"],
    ["crypto bitcoin", "bitcoin", "Crypto"],
  ])("%j → %j, %s", (text, terms, type) => {
    expect(parseQuery(text)).toEqual({ terms, type });
  });

  it("never filters on a lone word", () => {
    expect(parseQuery("coin")).toEqual({ terms: "coin", type: null });
    expect(parseQuery("  crypto  ")).toEqual({ terms: "crypto", type: null });
  });

  it("needs whole type words", () => {
    expect(parseQuery("bitcoin cry")).toEqual({ terms: "bitcoin cry", type: null });
  });

  it("collapses whitespace", () => {
    expect(parseQuery("  apple   inc ")).toEqual({ terms: "apple inc", type: null });
    expect(parseQuery("")).toEqual({ terms: "", type: null });
    expect(parseQuery("   ")).toEqual({ terms: "", type: null });
  });

  it("ignores Object.prototype names", () => {
    expect(parseQuery("apple constructor")).toEqual({ terms: "apple constructor", type: null });
    expect(parseQuery("x toString")).toEqual({ terms: "x toString", type: null });
  });

  it("knows its type words", () => {
    expect(Object.keys(TYPE_WORDS)).toHaveLength(18);
    expect(new Set(Object.values(TYPE_WORDS))).toEqual(new Set(["Crypto", "Stock", "ETF", "FX"]));
  });
});

describe("searchPlan", () => {
  it("asks for more hits when a type filters", () => {
    expect(searchPlan("sui crypto")).toEqual({ terms: "sui", type: "Crypto", quotesCount: 25 });
    expect(searchPlan("aapl")).toEqual({ terms: "aapl", type: null, quotesCount: 12 });
  });
});

describe("toSuggestion", () => {
  it("takes US stocks and ETFs", () => {
    expect(toSuggestion(hit.AAPL)).toEqual({
      market: stock("AAPL"),
      name: "Apple Inc.",
      type: "Stock",
      exchange: "NASDAQ",
    });
    expect(toSuggestion(hit.BRKB)).toEqual({
      market: stock("BRK.B"),
      name: "Berkshire Hathaway Inc.",
      type: "Stock",
      exchange: "NYSE",
    });
    expect(toSuggestion(hit.SPY)).toEqual({
      market: stock("SPY"),
      name: "SPDR S&P 500",
      type: "ETF",
      exchange: "NYSEArca",
    });
  });

  it("knows the US exchanges", () => {
    expect([...US_EXCHANGES]).toEqual(["NMS", "NGM", "NCM", "NAS", "NYQ", "NYS", "ASE", "PCX", "BTS"]);
  });

  it.each([
    ["a non-US stock", hit.SHOP_TO],
    ["a future", hit.GOLD],
    ["an index", hit.SPX],
    ["a symbol with a dot", { ...hit.AAPL, symbol: "BRK.B" }],
    ["a lower-case symbol", { ...hit.AAPL, symbol: "aapl" }],
    ["no symbol", { quoteType: "EQUITY", exchange: "NMS" }],
    ["a coin without a quote currency", { symbol: "BTC", quoteType: "CRYPTOCURRENCY" }],
    ["a currency without a pair", { symbol: "EUR=X", quoteType: "CURRENCY", shortname: "EUR" }],
    ["a currency without anything", { quoteType: "CURRENCY" }],
  ])("skips %s", (_, q) => {
    expect(toSuggestion(q)).toBeNull();
  });

  it("maps crypto to Binance's USDT pair and cleans the name", () => {
    expect(toSuggestion(hit.BTC)).toEqual({
      market: crypto("BTC/USDT"),
      name: "Bitcoin",
      type: "Crypto",
      exchange: "CCC",
    });
    expect(toSuggestion(hit.BTC_EUR)).toEqual({
      market: crypto("BTC/EUR"),
      name: "Bitcoin",
      type: "Crypto",
      exchange: "CCC",
    });
  });

  it("strips Yahoo's number from a crypto base and keeps its symbol", () => {
    expect(toSuggestion(hit.PEPE)).toEqual({
      market: { ...crypto("PEPE/USDT"), ysym: "PEPE24478-USD" },
      name: "Pepe",
      type: "Crypto",
      exchange: "CCC",
    });
    expect(toSuggestion(hit.SUI)?.market).toEqual({ ...crypto("SUI/USDT"), ysym: "SUI20947-USD" });
  });

  it("leaves short numbers and leading digits alone", () => {
    expect(toSuggestion({ symbol: "1INCH-USD", quoteType: "CRYPTOCURRENCY", shortname: "1inch USD" })).toEqual({
      market: crypto("1INCH/USDT"),
      name: "1inch",
      type: "Crypto",
      exchange: "",
    });
    expect(toSuggestion({ symbol: "ABC123-USD", quoteType: "CRYPTOCURRENCY" })?.market).toEqual(crypto("ABC123/USDT"));
  });

  it("takes FX from the shortname or the symbol", () => {
    expect(toSuggestion(hit.EURUSD)).toEqual({
      market: { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" },
      name: "EUR/USD",
      type: "FX",
      exchange: "CCY",
    });
    expect(toSuggestion({ symbol: "GBPJPY=X", quoteType: "CURRENCY", shortname: "Pound/Yen" })?.market).toEqual({
      id: "fx:GBP/JPY",
      kind: "fx",
      sym: "GBP/JPY",
    });
    expect(toSuggestion({ symbol: "EUR=X", quoteType: "CURRENCY", shortname: "USD/EUR" })?.market.sym).toBe("USD/EUR");
  });

  it("falls back for names and exchanges", () => {
    expect(toSuggestion({ symbol: "X", quoteType: "EQUITY", exchange: "NYQ" })).toEqual({
      market: stock("X"),
      name: "",
      type: "Stock",
      exchange: "NYQ",
    });
    // Only crypto names lose a trailing currency.
    expect(toSuggestion({ ...hit.AAPL, longname: "Something USD" })?.name).toBe("Something USD");
  });
});

const PAIRS = new Set([
  "BTCUSDT",
  "BTCEUR",
  "BTCUPUSDT",
  "BTCDOWNUSDT",
  "ETHUSDT",
  "ETHBULLUSDT",
  "ETHBEARUSDT",
  "ARBUSDT",
  "ARBBTC",
  "PEPEUSDT",
  "PEOPLEUSDT",
  "PENDLEUSDT",
  "PENGUUSDT",
  "SOLUSDT",
  "SOLVUSDT",
  "SOLBTC",
  "SUIUSDT",
  "SHIBUSDT",
  "SHIAUSDT",
  "SHIPUSDT",
  "SHIELDUSDT",
]);
const onBinance = (base, name = `${base} on Binance`) => ({
  market: crypto(`${base}/USDT`),
  name,
  type: "Crypto",
  exchange: "Binance",
});

describe("binanceMatches", () => {
  it("finds the exact base", () => {
    expect(binanceMatches("ARB", PAIRS, [])).toEqual([onBinance("ARB")]);
  });

  it("finds prefixes only when nothing else matched, with 3+ characters", () => {
    expect(binanceMatches("PEP", PAIRS, [])).toEqual([onBinance("PEPE")]);
    expect(binanceMatches("PE", PAIRS, [])).toEqual([]);
    const pep = toSuggestion(hit.PEP);
    expect(binanceMatches("PEP", PAIRS, [pep])).toEqual([]);
  });

  it("puts the exact base first, then the shortest, at most 3", () => {
    expect(binanceMatches("SHI", PAIRS, []).map((x) => x.market.sym)).toEqual(["SHIA/USDT", "SHIB/USDT", "SHIP/USDT"]);
    expect(binanceMatches("SOL", PAIRS, []).map((x) => x.market.sym)).toEqual(["SOL/USDT", "SOLV/USDT"]);
    expect(binanceMatches("PEN", PAIRS, []).map((x) => x.market.sym)).toEqual(["PENGU/USDT", "PENDLE/USDT"]);
  });

  it("skips leveraged tokens", () => {
    expect(binanceMatches("BTC", PAIRS, [])).toEqual([onBinance("BTC")]);
    expect(binanceMatches("ETH", PAIRS, [])).toEqual([onBinance("ETH")]);
  });

  it("uses Yahoo's name for the coin", () => {
    expect(binanceMatches("BTC", PAIRS, [toSuggestion(hit.BTC_EUR)])).toEqual([onBinance("BTC", "Bitcoin")]);
  });

  it("doesn't repeat what was found", () => {
    expect(binanceMatches("BTC", PAIRS, [toSuggestion(hit.BTC)])).toEqual([]);
  });

  it("looks for prefixes when only other types were found and crypto is wanted", () => {
    expect(binanceMatches("PEP", PAIRS, [toSuggestion(hit.PEP)], "Crypto")).toEqual([onBinance("PEPE")]);
  });

  it("does nothing for other types, without pairs, or for odd queries", () => {
    expect(binanceMatches("ARB", PAIRS, [], "Stock")).toEqual([]);
    expect(binanceMatches("ARB", null, [])).toEqual([]);
    expect(binanceMatches("A", PAIRS, [])).toEqual([]);
    expect(binanceMatches("BT C", PAIRS, [])).toEqual([]);
    expect(binanceMatches("ABCDEFGHIJKLM", PAIRS, [])).toEqual([]);
  });

  it("takes any iterable of pairs", () => {
    expect(binanceMatches("ARB", ["ARBUSDT", "ARBBTC"], [])).toEqual([onBinance("ARB")]);
  });
});

describe("rankSuggestions", () => {
  const fslr = toSuggestion(hit.FSLR);
  const sol = toSuggestion(hit.SOL);
  const solv = onBinance("SOLV");
  const aapl = toSuggestion(hit.AAPL);
  const eurusd = toSuggestion(hit.EURUSD);

  it("puts exact matches first, then prefixes, then Yahoo's order", () => {
    expect(rankSuggestions([fslr, solv, sol], "SOL")).toEqual([sol, solv, fslr]);
    expect(rankSuggestions([fslr, aapl], "AAPL")).toEqual([aapl, fslr]);
    expect(rankSuggestions([aapl, eurusd], "EUR/USD")).toEqual([eurusd, aapl]);
    expect(rankSuggestions([aapl, eurusd], "EUR")).toEqual([eurusd, aapl]);
  });

  it("filters by type", () => {
    expect(rankSuggestions([fslr, solv, sol], "SOL", "Stock")).toEqual([fslr]);
    expect(rankSuggestions([fslr, solv, sol], "SOL", "Crypto")).toEqual([sol, solv]);
  });

  it("keeps at most 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...aapl, market: stock(`A${i}`) }));
    expect(MAX_SUGGESTIONS).toBe(8);
    expect(rankSuggestions(many, "ZZZ")).toEqual(many.slice(0, 8));
  });
});

describe("buildSuggestions", () => {
  it("is empty for nothing typed", () => {
    expect(buildSuggestions({ text: "", quotes: [hit.AAPL], pairs: PAIRS })).toEqual([]);
    expect(buildSuggestions({ text: "   ", quotes: null, pairs: null })).toEqual([]);
  });

  it("ranks Solana before First Solar for 'sol', dropping pairs Binance lacks", () => {
    const out = buildSuggestions({ text: "sol", quotes: [hit.FSLR, hit.SOL, hit.SOL_EUR, hit.SOL], pairs: PAIRS });
    // SOL/EUR isn't on Binance; SOLV isn't suggested because Yahoo already found something.
    expect(out.map((x) => x.market.id)).toEqual(["crypto:SOL/USDT", "stock:FSLR"]);
  });

  it("keeps Yahoo's crypto when Binance's pairs are unknown", () => {
    const out = buildSuggestions({ text: "sol", quotes: [hit.FSLR, hit.SOL, hit.SOL_EUR], pairs: null });
    expect(out.map((x) => x.market.id)).toEqual(["crypto:SOL/USDT", "crypto:SOL/EUR", "stock:FSLR"]);
  });

  it("drops tokens Binance doesn't trade", () => {
    const out = buildSuggestions({ text: "brkb", quotes: [hit.BRKB, hit.BRKB_USD], pairs: PAIRS });
    expect(out.map((x) => x.market.id)).toEqual(["stock:BRK.B"]);
  });

  it("dedupes Yahoo's hits", () => {
    const out = buildSuggestions({ text: "aapl", quotes: [hit.AAPL, hit.AAPL], pairs: PAIRS });
    expect(out).toEqual([toSuggestion(hit.AAPL)]);
  });

  it("filters with a type word: 'coin stock' is Coinbase", () => {
    const out = buildSuggestions({ text: "coin stock", quotes: [hit.COIN, hit.BTC], pairs: PAIRS });
    expect(out.map((x) => x.market.id)).toEqual(["stock:COIN"]);
  });

  it("searches a lone 'coin' instead of filtering", () => {
    const out = buildSuggestions({ text: "coin", quotes: [hit.COIN, hit.BTC], pairs: PAIRS });
    expect(out.map((x) => x.market.id)).toEqual(["stock:COIN", "crypto:BTC/USDT"]);
  });

  it("finds 'sui crypto' under Yahoo's numbered symbol", () => {
    const out = buildSuggestions({ text: "sui crypto", quotes: [hit.SUI, hit.AAPL], pairs: PAIRS });
    expect(out).toEqual([
      { market: { ...crypto("SUI/USDT"), ysym: "SUI20947-USD" }, name: "Sui", type: "Crypto", exchange: "CCC" },
    ]);
  });

  it("adds Binance's coins Yahoo misses ('arb')", () => {
    const out = buildSuggestions({ text: "arb", quotes: [hit.ARBE], pairs: PAIRS });
    expect(out).toEqual([onBinance("ARB"), toSuggestion(hit.ARBE)]);
  });

  it("finds prefixes when the type has nothing yet ('pep crypto')", () => {
    expect(buildSuggestions({ text: "pep crypto", quotes: [hit.PEP], pairs: PAIRS })).toEqual([onBinance("PEPE")]);
    expect(buildSuggestions({ text: "pep", quotes: [hit.PEP], pairs: PAIRS })).toEqual([toSuggestion(hit.PEP)]);
  });

  it("works with Yahoo down", () => {
    expect(buildSuggestions({ text: "arb", quotes: [], pairs: PAIRS })).toEqual([onBinance("ARB")]);
    expect(buildSuggestions({ text: "arb", quotes: undefined, pairs: PAIRS })).toEqual([onBinance("ARB")]);
    expect(buildSuggestions({ text: "zzzz", quotes: [], pairs: PAIRS })).toEqual([]);
  });

  it("is offline when both sources are", () => {
    expect(() => buildSuggestions({ text: "aapl", quotes: [], pairs: null })).toThrow("offline");
    expect(() => buildSuggestions({ text: "aapl", quotes: null, pairs: null })).toThrow("offline");
  });

  it("isn't offline when Yahoo answered with nothing usable", () => {
    expect(buildSuggestions({ text: "gold", quotes: [hit.GOLD], pairs: null })).toEqual([]);
  });

  it("keeps at most 8", () => {
    const quotes = Array.from({ length: 12 }, (_, i) => ({ ...hit.AAPL, symbol: `AA${String.fromCharCode(65 + i)}` }));
    expect(buildSuggestions({ text: "zz", quotes, pairs: PAIRS })).toHaveLength(8);
  });
});
