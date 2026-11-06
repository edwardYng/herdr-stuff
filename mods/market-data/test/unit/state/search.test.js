import { describe, it, expect, vi } from "vitest";
import { InputState } from "gpui-base";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { Search, DEBOUNCE_MS, BLUR_CLOSE_MS, SEARCH_NOT_SYMBOL, PLACEHOLDER } from "../../../src/state/search.js";
import { fakeSources, fixture, settle } from "../../support/fake-sources.js";

const APPLE = fixture("yahoo/search/apple.json").quotes;

function make(data = fakeSources({ yahoo: { search: vi.fn(async () => APPLE) } })) {
  const input = InputState.new({ placeholder: PLACEHOLDER });
  const picked = [];
  const search = new Search({ input, data, onPick: (m) => picked.push(m) });
  return { input, search, data, picked, cx: createCx() };
}

/** A cx whose sleeps wait until released, in order. */
function manualSleep(cx) {
  const waits = [];
  cx.sleep = (ms) => new Promise((r) => waits.push({ ms, release: r }));
  return waits;
}

describe("searching while typing", () => {
  it("shows Yahoo's (and Binance's) suggestions after the debounce, the first highlighted", async () => {
    const { input, search, data, cx } = make();
    const waits = manualSleep(cx);
    input.type("apple", cx);
    await Promise.resolve();
    expect(waits.map((w) => w.ms)).toEqual([DEBOUNCE_MS]);
    expect(data.yahoo.search).not.toHaveBeenCalled();
    waits[0].release();
    await cx.flush();
    expect(data.yahoo.search).toHaveBeenCalledWith("apple", 12);
    expect(data.binance.pairs).toHaveBeenCalled();
    expect(search.open).toBe(true);
    expect(search.sel).toBe(0);
    expect(search.sugg[0].market.id).toBe("stock:AAPL");
  });

  it("asks for more hits when a type word filters", async () => {
    const { input, data, cx } = make();
    input.type("sol crypto", cx);
    await cx.flush();
    expect(data.yahoo.search).toHaveBeenCalledWith("sol", 25);
  });

  it("skips empty text and explicit forms (BTC/USDT, stock:…), closing the dropdown", async () => {
    const { input, search, data, cx } = make();
    input.type("apple", cx);
    await cx.flush();
    for (const text of ["  ", "BTC/USDT", "stock:AAPL"]) {
      input.type(text, cx);
      expect(search.open).toBe(false);
      expect(search.sugg).toEqual([]);
    }
    await cx.flush();
    expect(data.yahoo.search).toHaveBeenCalledTimes(1);
  });

  it("drops a keystroke superseded during the debounce, and an answer superseded in flight", async () => {
    const answers = [];
    const data = fakeSources({ yahoo: { search: vi.fn(() => new Promise((r) => answers.push(r))) } });
    const { input, search, cx } = make(data);
    const waits = manualSleep(cx);
    input.type("ap", cx);
    input.type("app", cx);
    await settle();
    waits[0].release();
    await settle();
    expect(data.yahoo.search).not.toHaveBeenCalled();

    waits[1].release();
    await settle();
    expect(data.yahoo.search).toHaveBeenCalledWith("app", 12);
    input.type("apple", cx);
    answers[0](APPLE); // "app" answers after "apple" was typed: ignored
    await settle();
    expect(search.open).toBe(false);

    waits[2].release();
    await settle();
    answers[1](APPLE);
    await settle();
    expect(search.open).toBe(true);
    expect(search.cache.APP).toBeDefined();
  });

  it("answers again from the cache, by upper-cased text, without asking", async () => {
    const { input, search, data, cx } = make();
    input.type("apple", cx);
    await cx.flush();
    input.type("", cx);
    input.type("APPLE", cx);
    expect(search.open).toBe(true);
    expect(search.sugg.length).toBeGreaterThan(0);
    await cx.flush();
    expect(data.yahoo.search).toHaveBeenCalledTimes(1);
  });

  it("Yahoo failing still leaves Binance's matches", async () => {
    const data = fakeSources({ yahoo: { search: vi.fn(async () => Promise.reject(new Error("offline"))) } });
    const { input, search, cx } = make(data);
    input.type("arb", cx);
    await cx.flush();
    expect(search.sugg.map((s) => s.market.id)).toEqual(["crypto:ARB/USDT"]);
  });

  it("both sources down: no dropdown", async () => {
    const data = fakeSources({
      yahoo: { search: vi.fn(async () => Promise.reject(new Error("offline"))) },
      binance: { pairs: vi.fn(async () => null) },
    });
    const { input, search, cx } = make(data);
    input.type("zzz", cx);
    await cx.flush();
    expect(search.open).toBe(false);
    expect(search.sugg).toEqual([]);
    expect(cx.notifies).toBeGreaterThan(0);
  });

  it("nothing found: an open, empty dropdown that says what Enter does", async () => {
    const data = fakeSources({ binance: { pairs: vi.fn(async () => new Set()) } });
    const { input, search, cx } = make(data);
    input.type("qqqzz", cx);
    await cx.flush();
    expect(search.open).toBe(true);
    expect(search.sel).toBe(-1);
    expect(search.emptyMessage()).toBe('No matches. Enter adds "QQQZZ" as typed.');
    input.set_value("gold etf");
    expect(search.emptyMessage()).toBe('No ETF matches for "gold".');
    input.set_value("eur fx");
    expect(search.emptyMessage()).toBe('No FX matches for "eur".');
    input.set_value("sui crypto");
    expect(search.emptyMessage()).toBe('No crypto matches for "sui".');
    input.set_value("coin stock");
    expect(search.emptyMessage()).toBe('No stock matches for "coin".');
  });

  it("typing clears the error", async () => {
    const { input, search, cx } = make();
    search.err = "x";
    input.type("a", cx);
    expect(search.err).toBe("");
  });
});

describe("keys", () => {
  const key = (k) => ({ key: k, keystroke: k, modifiers: {} });

  it("down/up move the highlight and wrap; escape closes; each stops the key", async () => {
    const { input, search, cx } = make();
    input.type("apple", cx);
    await cx.flush();
    const n = search.sugg.length;
    expect(n).toBeGreaterThan(2);
    search.key(key("down"), cx);
    expect(search.sel).toBe(1);
    expect(cx.stopped).toBe(true);
    search.key(key("up"), cx);
    search.key(key("up"), cx);
    expect(search.sel).toBe(n - 1);
    search.key(key("down"), cx);
    expect(search.sel).toBe(0);
    search.key(key("escape"), cx);
    expect(search.open).toBe(false);
  });

  it("other keys, or keys while closed, pass through", async () => {
    const { input, search, cx } = make();
    search.key(key("down"), cx);
    expect(cx.stopped).toBe(false);
    input.type("apple", cx);
    await cx.flush();
    search.key(key("a"), cx);
    expect(cx.stopped).toBe(false);
    expect(search.sel).toBe(0);
  });

  it("highlight: sets the hovered suggestion (redrawing only on change)", () => {
    const { search, cx } = make();
    search.highlight(2, cx);
    search.highlight(2, cx);
    expect(search.sel).toBe(2);
    expect(cx.notifies).toBe(1);
  });
});

describe("focus", () => {
  it("focus reopens the suggestions there are; blur closes them 200ms later unless refocused", async () => {
    const { input, search, cx } = make();
    input.type("apple", cx);
    await cx.flush();
    search.open = false;
    input.emit("focus", cx);
    expect(search.open).toBe(true);

    const waits = manualSleep(cx);
    input.emit("blur", cx);
    await Promise.resolve();
    expect(waits[0].ms).toBe(BLUR_CLOSE_MS);
    input.emit("focus", cx);
    waits[0].release();
    await new Promise((r) => setTimeout(r, 0));
    expect(search.open).toBe(true);

    input.emit("blur", cx);
    await Promise.resolve();
    waits[1].release();
    await new Promise((r) => setTimeout(r, 0));
    expect(search.open).toBe(false);
  });

  it("focus with an empty box opens nothing", () => {
    const { input, search, cx } = make();
    search.sugg = [{ market: { id: "stock:A", kind: "stock", sym: "A" }, name: "", type: "Stock", exchange: "" }];
    input.emit("focus", cx);
    expect(search.open).toBe(false);
    expect(search.focused).toBe(true);
  });
});

describe("submit (Enter)", () => {
  it("adds the highlighted suggestion, clearing the box and closing the dropdown", async () => {
    const { input, search, picked, cx } = make();
    input.type("apple", cx);
    await cx.flush();
    search.key({ key: "down" }, cx);
    const want = search.sugg[1].market;
    input.emit("submit", cx);
    expect(picked).toEqual([want]);
    expect(input.value()).toBe("");
    expect(search.open).toBe(false);
  });

  it("a search with a type word isn't a symbol", () => {
    const { input, search, picked, cx } = make();
    input.set_value("sui crypto");
    input.emit("submit", cx);
    expect(search.err).toBe(SEARCH_NOT_SYMBOL);
    expect(picked).toEqual([]);
  });

  it("else reads the text as typed, or says it can't", () => {
    const { input, search, picked, cx } = make();
    input.set_value("btcusdt");
    input.emit("submit", cx);
    expect(picked).toEqual([{ id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" }]);
    input.set_value(" $$$ ");
    input.emit("submit", cx);
    expect(search.err).toBe('Can\'t read "$$$"');
    expect(picked).toHaveLength(1);
  });
});
