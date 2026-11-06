import { describe, it, expect } from "vitest";
import { parseMarket, yahooSymbol, binanceSymbol, FIAT, STABLECOINS } from "../../../src/domain/markets.js";

describe("parseMarket", () => {
  it.each([
    ["AAPL", { id: "stock:AAPL", kind: "stock", sym: "AAPL" }],
    ["  aapl ", { id: "stock:AAPL", kind: "stock", sym: "AAPL" }],
    ["brk.b", { id: "stock:BRK.B", kind: "stock", sym: "BRK.B" }],
    ["BTC/USDT", { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" }],
    ["btcusdt", { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" }],
    ["ETHBTC", { id: "crypto:ETH/BTC", kind: "crypto", sym: "ETH/BTC" }],
    ["PEPEFDUSD", { id: "crypto:PEPE/FDUSD", kind: "crypto", sym: "PEPE/FDUSD" }],
    ["sol-usdc", { id: "crypto:SOL/USDC", kind: "crypto", sym: "SOL/USDC" }],
    ["sol_usdc", { id: "crypto:SOL/USDC", kind: "crypto", sym: "SOL/USDC" }],
    ["EUR/USD", { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" }],
    ["eur / usd", { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" }],
    ["EURUSD", { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" }],
    ["usdjpy", { id: "fx:USD/JPY", kind: "fx", sym: "USD/JPY" }],
    ["BTC/EUR", { id: "crypto:BTC/EUR", kind: "crypto", sym: "BTC/EUR" }],
  ])("%s", (text, want) => {
    expect(parseMarket(text)).toEqual(want);
  });

  it("needs 6+ characters before guessing a crypto pair from its ending", () => {
    // "ETHBTC" is 6: crypto. "ABTC" is 4: a stock ticker.
    expect(parseMarket("ABTC")).toEqual({ id: "stock:ABTC", kind: "stock", sym: "ABTC" });
    expect(parseMarket("XRPBTC")).toEqual({ id: "crypto:XRP/BTC", kind: "crypto", sym: "XRP/BTC" });
    // With crypto: forced, 5 characters split too; a 1-character base doesn't.
    expect(parseMarket("crypto:OPBTC")).toEqual({ id: "crypto:OP/BTC", kind: "crypto", sym: "OP/BTC" });
    expect(parseMarket("OPBTC")).toEqual({ id: "stock:OPBTC", kind: "stock", sym: "OPBTC" });
    expect(parseMarket("crypto:ABTC")).toEqual({ id: "crypto:ABTC", kind: "crypto", sym: "ABTC" });
  });

  it("forces the kind with a prefix", () => {
    expect(parseMarket("stock:BTCUSDT")).toEqual({ id: "stock:BTCUSDT", kind: "stock", sym: "BTCUSDT" });
    expect(parseMarket("stock:ETHBTC")).toEqual({ id: "stock:ETHBTC", kind: "stock", sym: "ETHBTC" });
    expect(parseMarket("crypto:BTCUSDT")).toEqual({ id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" });
    expect(parseMarket("crypto:EUR/USD")).toEqual({ id: "crypto:EUR/USD", kind: "crypto", sym: "EUR/USD" });
    expect(parseMarket("fx:EURUSD")).toEqual({ id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" });
    expect(parseMarket("fx:eur-gbp")).toEqual({ id: "fx:EUR/GBP", kind: "fx", sym: "EUR/GBP" });
    expect(parseMarket("Stock:msft")).toEqual({ id: "stock:MSFT", kind: "stock", sym: "MSFT" });
  });

  it("splits a 6-letter fx: symbol even when it isn't two known fiats", () => {
    expect(parseMarket("fx:ABCDEF")).toEqual({ id: "fx:ABC/DEF", kind: "fx", sym: "ABC/DEF" });
  });

  it("treats 6 letters that aren't two fiats as a stock", () => {
    expect(parseMarket("EURXYZ")).toEqual({ id: "stock:EURXYZ", kind: "stock", sym: "EURXYZ" });
  });

  it.each([
    [""],
    ["   "],
    ["1ABC"], // stocks start with a letter
    ["ABCDEFGHIJK"], // 11 characters
    ["A/B/C"],
    ["BTC/"],
    ["/USDT"],
    ["AA$PL"],
    ["crypto:$$"],
    ["crypto:A"],
  ])("rejects %j", (text) => {
    expect(parseMarket(text)).toBeNull();
  });

  it("accepts a forced fx:/crypto: symbol without a pair (reference quirk)", () => {
    expect(parseMarket("fx:EUR")).toEqual({ id: "fx:EUR", kind: "fx", sym: "EUR" });
    expect(parseMarket("crypto:BTC")).toEqual({ id: "crypto:BTC", kind: "crypto", sym: "BTC" });
  });

  it("accepts a 10-character stock symbol", () => {
    expect(parseMarket("ABCDEFGHIJ")?.kind).toBe("stock");
  });
});

describe("yahooSymbol", () => {
  it.each([
    [{ id: "stock:AAPL", kind: "stock", sym: "AAPL" }, "AAPL"],
    [{ id: "stock:BRK.B", kind: "stock", sym: "BRK.B" }, "BRK-B"],
    [{ id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" }, "EURUSD=X"],
    [{ id: "fx:USD/JPY", kind: "fx", sym: "USD/JPY" }, "USDJPY=X"],
    [{ id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" }, "BTC-USD"],
    [{ id: "crypto:BTC/USDC", kind: "crypto", sym: "BTC/USDC" }, "BTC-USD"],
    [{ id: "crypto:ETH/FDUSD", kind: "crypto", sym: "ETH/FDUSD" }, "ETH-USD"],
    [{ id: "crypto:BTC/EUR", kind: "crypto", sym: "BTC/EUR" }, "BTC-EUR"],
    [{ id: "crypto:ETH/BTC", kind: "crypto", sym: "ETH/BTC" }, "ETH-BTC"],
    [{ id: "crypto:PEPE/USDT", kind: "crypto", sym: "PEPE/USDT", ysym: "PEPE24478-USD" }, "PEPE24478-USD"],
  ])("%j → %s", (m, want) => {
    expect(yahooSymbol(/** @type {any} */ (m))).toBe(want);
  });
});

describe("binanceSymbol", () => {
  it("drops the slash", () => {
    expect(binanceSymbol("BTC/USDT")).toBe("BTCUSDT");
    expect(binanceSymbol("BTCUSDT")).toBe("BTCUSDT");
  });
});

describe("constants", () => {
  it("knows the fiats and stablecoins", () => {
    expect(FIAT.size).toBe(27);
    expect(FIAT.has("JPY")).toBe(true);
    expect(FIAT.has("USDT")).toBe(false);
    expect([...STABLECOINS]).toEqual(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USDP"]);
  });
});
