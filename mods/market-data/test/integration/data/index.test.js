import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { herdrMock } from "../../../../../test-support/herdr-mock.js";
import { createDataSources, HttpError, errorLabel } from "../../../src/data/index.js";
import { fakeCurl, fakeFetch, fcHeaders, fixture, memoryStorage } from "./fakes.js";

beforeEach(() => herdrMock.reset());
afterEach(() => vi.unstubAllGlobals());

describe("createDataSources", () => {
  it("wires every client to the given dependencies", async () => {
    const fetch = fakeFetch([
      ["/klines", { fixture: "binance/klines-BTCUSDT.json" }],
      ["/v8/finance/chart/", { fixture: "yahoo/chart/AAPL-1d.json" }],
      ["data.alpaca.markets", { json: {} }],
    ]);
    const exec = fakeCurl([
      [(u) => u === "https://fc.yahoo.com", { status: 404, headers: fcHeaders() }],
      [(u) => u.endsWith("/getcrumb"), { body: "c" }],
      [(u) => u.includes("/quoteSummary/"), { fixture: "yahoo/summary/AAPL.json" }],
    ]);
    const storage = memoryStorage();
    const d = createDataSources({ fetch, exec, platform: "linux", storage, now: () => 0 });
    expect((await d.binance.history("BTC/USDT")).spark).toHaveLength(288);
    expect((await d.yahoo.chart("AAPL", "1d")).closes.length).toBeGreaterThan(0);
    expect((await d.fx.history("EUR/USD")).price).toBe(
      fixture("yahoo/chart/AAPL-1d.json").chart.result[0].meta.regularMarketPrice,
    );
    expect(await d.alpaca.quotes(["AAPL"], { key: "k", secret: "s" })).toEqual({});
    expect((await d.yahoo.quoteSummary("AAPL")).price.symbol).toBe("AAPL");
    expect(storage.data.has("yahoo")).toBe(true);
    expect(d.alpacaStream).toBe("wss://stream.data.alpaca.markets/v2/iex");
    expect(d.yahooSession.current()).toMatchObject({ crumb: "c" });
    expect(errorLabel(new HttpError(404))).toBe("not found");
  });

  it("defaults to the runtime's fetch, herdr's exec and localStorage, looked up at call time", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    const d = createDataSources({ platform: "linux" });
    expect(getItem).not.toHaveBeenCalled();

    const fetch = fakeFetch([["/ticker/24hr", { json: { symbol: "BTCUSDT" } }]]);
    vi.stubGlobal("fetch", fetch);
    expect(await d.binance.ticker24h("BTC/USDT")).toEqual({ symbol: "BTCUSDT" });
    expect(fetch.calls).toHaveLength(1);

    herdrMock.exec = async (_cmd, args) => ({
      code: 0,
      stdout: `${args.at(-1).includes("KEY_ID") ? "kid" : "sec"}`,
      stderr: "",
    });
    expect(await d.alpacaKeys()).toEqual({ key: "kid", secret: "sec" });

    herdrMock.exec = fakeCurl([
      [(u) => u === "https://fc.yahoo.com", { status: 404, headers: fcHeaders() }],
      [(u) => u.endsWith("/getcrumb"), { body: "c" }],
      [(u) => u.includes("/quoteSummary/"), { fixture: "yahoo/summary/AAPL.json" }],
    ]);
    await d.yahoo.quoteSummary("AAPL");
    expect(getItem).toHaveBeenCalledWith("yahoo");
    expect(setItem).toHaveBeenCalledWith("yahoo", expect.stringContaining('"crumb":"c"'));
  });

  it("takes the platform from process", () => {
    herdrMock.exec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    return createDataSources({ storage: null })
      .alpacaKeys()
      .then(() => {
        expect(herdrMock.exec.mock.calls[0][0]).toBe(process.platform === "win32" ? "powershell" : "sh");
      });
  });
});
