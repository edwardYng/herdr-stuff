import { describe, it, expect, vi, beforeEach } from "vitest";
import { herdrMock } from "../../../../../test-support/herdr-mock.js";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { Detail, RELOAD_MS, quotePage } from "../../../src/state/detail.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeSources, chartFixture, quoteSummaryFixture } from "../../support/fake-sources.js";

const AAPL = { id: "stock:AAPL", kind: "stock", sym: "AAPL" };
const BTC = { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" };
const EUR = { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" };

beforeEach(() => herdrMock.reset());

function make(market = AAPL, data = fakeSources(), extra = {}) {
  const d = new Detail({ market, price: 100, ref: 99, overlay: "ov1", ...extra }, { data });
  return { d, data, cx: createCx() };
}

describe("Detail", () => {
  it("keeps the tile's numbers as the seed and derives Yahoo's symbol", () => {
    const { d } = make({ id: "stock:BRK.B", kind: "stock", sym: "BRK.B" });
    expect(d.seed).toEqual({ price: 100, ref: 99 });
    expect(d.ysym).toBe("BRK-B");
    expect(new Detail({ market: AAPL }, { data: fakeSources() }).seed).toEqual({ price: null, ref: null });
    expect(quotePage("EURUSD=X")).toBe("https://finance.yahoo.com/quote/EURUSD%3DX/");
  });

  it("start: loads the quote and the 1D chart, then reloads both every 30s", async () => {
    const { d, data, cx } = make();
    d.start(cx);
    await cx.flush();
    expect(data.yahoo.quoteSummary).toHaveBeenCalledWith("AAPL");
    expect(data.yahoo.chart).toHaveBeenCalledWith("AAPL", "1d", { rolling: false });
    expect(d.q.price.symbol).toBe("AAPL");
    expect(d.chart().closes.length).toBeGreaterThan(10);
    expect(d.chartMeta().symbol).toBe("AAPL");
    expect(data.binance.ticker24h).not.toHaveBeenCalled();

    cx.tick(RELOAD_MS);
    await cx.flush();
    expect(data.yahoo.quoteSummary).toHaveBeenCalledTimes(2);
    expect(data.yahoo.chart).toHaveBeenCalledTimes(2);
  });

  it("crypto: a rolling 1D chart and Binance's 24h stats", async () => {
    const data = fakeSources({ yahoo: { chart: vi.fn(async () => chartFixture("BTC-USD-2d")) } });
    const { d, cx } = make(BTC, data);
    d.start(cx);
    await cx.flush();
    expect(data.yahoo.chart).toHaveBeenCalledWith("BTC-USD", "1d", { rolling: true });
    expect(data.binance.ticker24h).toHaveBeenCalledWith("BTC/USDT");
    expect(d.bin.symbol).toBe("BTCUSDT");

    data.binance.ticker24h.mockRejectedValueOnce(new Error("x"));
    d.load(cx);
    await cx.flush();
    expect(d.bin.symbol).toBe("BTCUSDT");
  });

  it("FX charts are rolling too", async () => {
    const { d, data, cx } = make(EUR);
    d.loadChart(cx, "1d");
    await cx.flush();
    expect(data.yahoo.chart).toHaveBeenCalledWith("EURUSD=X", "1d", { rolling: true });
  });

  it("a quote error is kept as its message, and cleared by the next answer", async () => {
    const data = fakeSources({
      yahoo: { quoteSummary: vi.fn(async () => Promise.reject(new Error("no Yahoo cookie"))) },
    });
    const { d, cx } = make(AAPL, data);
    d.load(cx);
    await cx.flush();
    expect(d.q).toBeNull();
    expect(d.qErr).toBe("no Yahoo cookie");
    data.yahoo.quoteSummary.mockResolvedValueOnce(quoteSummaryFixture("AAPL"));
    d.load(cx);
    await cx.flush();
    expect(d.qErr).toBe("");
    data.yahoo.quoteSummary.mockRejectedValueOnce("weird");
    d.load(cx);
    await cx.flush();
    expect(d.qErr).toBe("weird");
    expect(d.q).not.toBeNull();
  });

  it("chart errors: 404 → no chart for this symbol, else unavailable; only while there's no chart", async () => {
    const chart = vi.fn(async () => Promise.reject(new HttpError(404)));
    const { d, cx } = make(AAPL, fakeSources({ yahoo: { chart } }));
    d.loadChart(cx, "1d");
    await cx.flush();
    expect(d.chartErr).toBe("No chart for this symbol");
    chart.mockRejectedValueOnce(new Error("offline"));
    d.loadChart(cx, "1d");
    await cx.flush();
    expect(d.chartErr).toBe("Chart unavailable");

    chart.mockResolvedValueOnce(chartFixture("AAPL-1d"));
    d.loadChart(cx, "1d");
    await cx.flush();
    expect(d.chartErr).toBe("");
    chart.mockRejectedValueOnce(new Error("offline"));
    d.loadChart(cx, "1d", true);
    await cx.flush();
    expect(d.chartErr).toBe("");
    expect(d.chart()).not.toBeNull();
  });

  it("charts are cached per range unless forced", async () => {
    const { d, data, cx } = make();
    d.loadChart(cx, "1d");
    await cx.flush();
    d.loadChart(cx, "1d");
    expect(data.yahoo.chart).toHaveBeenCalledTimes(1);
    d.loadChart(cx, "1d", true);
    await cx.flush();
    expect(data.yahoo.chart).toHaveBeenCalledTimes(2);
  });

  it("setRange loads that range and resets the hover", async () => {
    const { d, data, cx } = make();
    d.hover = 5;
    d.setRange("5y", cx);
    await cx.flush();
    expect(d.range).toBe("5y");
    expect(d.hover).toBeNull();
    expect(data.yahoo.chart).toHaveBeenCalledWith("AAPL", "5y", { rolling: false });
    expect(d.chart()).not.toBeNull();
    expect(cx.notifies).toBeGreaterThan(0);
  });

  it("setHover redraws only on change; toggleMore flips", () => {
    const { d, cx } = make();
    d.setHover(3, cx);
    d.setHover(3, cx);
    expect(cx.notifies).toBe(1);
    d.setHover(null, cx);
    expect(d.hover).toBeNull();
    d.toggleMore(cx);
    expect(d.more).toBe(true);
    d.toggleMore(cx);
    expect(d.more).toBe(false);
  });

  it("close closes its own overlay (when it has one)", () => {
    make().d.close();
    expect(herdrMock.closed).toEqual(["ov1"]);
    make(AAPL, fakeSources(), { overlay: undefined }).d.close();
    expect(herdrMock.closed).toEqual(["ov1"]);
  });
});
