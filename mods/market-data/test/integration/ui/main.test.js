import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { herdrMock } from "../../../../../test-support/herdr-mock.js";
import { socketMock } from "../../../../../test-support/stubs/websocket.js";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { textOf, byId } from "../../../../../test-support/element.js";
import Markets from "../../../main.js";
import { REFRESH_MS, HISTORY_MS, PAINT_MS } from "../../../src/state/watchlist.js";
import { RELOAD_MS } from "../../../src/state/detail.js";
import { fakeFetch, fakeCurl, fcHeaders } from "../data/fakes.js";
import { memoryStorage, settle } from "../../support/fake-sources.js";

beforeEach(() => {
  herdrMock.reset();
  socketMock.reset();
  vi.stubGlobal(
    "fetch",
    fakeFetch([
      ["/klines", { fixture: "binance/klines-BTCUSDT.json" }],
      ["/ticker/24hr", { fixture: "binance/ticker24hr-BTCUSDT.json" }],
      ["/ticker/price", { fixture: "binance/ticker-price.json" }],
      ["/v8/finance/chart/EURUSD", { fixture: "yahoo/chart/EURUSD-2d.json" }],
      ["/v8/finance/chart/", { fixture: "yahoo/chart/AAPL-1d.json" }],
      ["/v1/finance/search", { fixture: "yahoo/search/apple.json" }],
    ]),
  );
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

/** Lets the tasks run (cx.flush would wait for the stream loop, which never ends). */
const idle = async () => {
  for (let i = 0; i < 5; i++) await settle();
};

describe("main.js", () => {
  it("without a market prop: the watchlist tile, with its timers and streams; close stops them", async () => {
    const view = new Markets();
    const cx = createCx();
    view.init({}, cx);
    await idle();
    expect(view.detail).toBeUndefined();
    expect(cx.timers.map((t) => t.ms).sort((a, b) => a - b)).toEqual([PAINT_MS, REFRESH_MS, HISTORY_MS]);

    const el = view.render(cx);
    expect(byId(el, "market-data")).toBeTruthy();
    // No Alpaca keys in this environment (exec answers nothing).
    expect(textOf(el)).toContain("no Alpaca keys");
    expect(textOf(byId(el, "row-stock:AAPL"))).toContain("set Alpaca keys");
    expect(textOf(byId(el, "row-crypto:BTC/USDT"))).toMatch(/^BTC\/USDT \| [\d,]+\.\d\d \| [-+]\d+\.\d\d% \| ×$/);
    expect(textOf(byId(el, "row-fx:EUR/USD"))).toMatch(/^EUR\/USD \| 1\.\d{4} \| /);
    // The crypto stream is open; no stock stream without keys.
    expect(socketMock.connects.map((s) => s.url)).toEqual([
      "wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker",
    ]);

    // Typing searches through the real data clients.
    view.search.input.type("apple", cx);
    await idle();
    expect(textOf(byId(view.render(cx), "suggest"))).toContain("Apple Inc.");

    await view.close();
    expect(socketMock.connects[0].closed).toBe(true);
  });

  it("with a market prop: the details popup", async () => {
    herdrMock.props = { market: { id: "stock:AAPL", kind: "stock", sym: "AAPL" }, price: 1, ref: 1, overlay: "ov2" };
    herdrMock.exec = fakeCurl([
      [(u) => u === "https://fc.yahoo.com", { status: 404, headers: fcHeaders() }],
      [(u) => u.endsWith("/getcrumb"), { body: "c" }],
      [(u) => u.includes("/quoteSummary/"), { fixture: "yahoo/summary/AAPL.json" }],
    ]);
    const view = new Markets();
    const cx = createCx();
    view.init({}, cx);
    await cx.flush();
    expect(view.detail).toBeTruthy();
    expect(cx.timers.map((t) => t.ms)).toEqual([RELOAD_MS]);
    const el = view.render(cx);
    expect(byId(el, "market-detail")).toBeTruthy();
    expect(textOf(el)).toContain("Apple Inc.");
    expect(textOf(el)).toContain("Valuation & Financials");
    await view.close();
    expect(socketMock.connects).toEqual([]);
  });
});
