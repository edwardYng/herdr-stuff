import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputState } from "gpui-base";
import { herdrMock } from "../../../../../test-support/herdr-mock.js";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { textOf, findAll, byId, called } from "../../../../../test-support/element.js";
import { Watchlist, LIST_KEY } from "../../../src/state/watchlist.js";
import { Search, PLACEHOLDER, SEARCH_NOT_SYMBOL } from "../../../src/state/search.js";
import { tileView, openDetail } from "../../../src/ui/tile-view.js";
import { INFO_LINES } from "../../../src/ui/info-panel.js";
import { readTheme } from "../../../src/ui/theme.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeSources, memoryStorage, fixture, history, KEYS } from "../../support/fake-sources.js";

const AAPL = { id: "stock:AAPL", kind: "stock", sym: "AAPL" };
const BTC = { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" };
const EUR = { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" };

beforeEach(() => herdrMock.reset());

async function setup({ list = [AAPL, BTC, EUR], data } = {}) {
  data ??= fakeSources({
    yahoo: { search: vi.fn(async () => fixture("yahoo/search/apple.json").quotes) },
    alpaca: { history: vi.fn(async () => history(200, 190, [195, 198, 200])) },
    fx: { history: vi.fn(async () => Promise.reject(new HttpError(0))) },
  });
  const cx = createCx();
  const watchlist = new Watchlist({ data, storage: memoryStorage({ [LIST_KEY]: JSON.stringify(list) }) });
  watchlist.keys = KEYS;
  const input = InputState.new({ placeholder: PLACEHOLDER });
  const search = new Search({ input, data, onPick: (m, cx) => watchlist.add(m, cx) });
  const ui = {};
  watchlist.refreshAll(cx);
  await cx.flush();
  const render = () => tileView({ watchlist, search, ui, zoom: 1 }, readTheme());
  return { watchlist, search, input, ui, cx, data, render };
}

describe("tile view", () => {
  it("renders a row per market: symbol, price, change, ×; errors in place of a price", async () => {
    const { render } = await setup();
    const el = render();
    expect(textOf(byId(el, "row-stock:AAPL"))).toBe("AAPL | 200.00 | +5.26% | ×");
    expect(textOf(byId(el, "row-crypto:BTC/USDT"))).toBe("BTC/USDT | 50,000.00 | +2.04% | ×");
    expect(textOf(byId(el, "row-fx:EUR/USD"))).toBe("EUR/USD | offline |  | ×");
    expect(textOf(el)).toContain("Markets");
    expect(textOf(el)).toContain("Prices are refreshed every 15s");
  });

  it("draws a sparkline, coloured by the day's direction", async () => {
    const { render, watchlist } = await setup();
    let row = byId(render(), "row-stock:AAPL");
    let bars = findAll(row, (n) => typeof n.elId === "string" && /^s\d+$/.test(n.elId));
    expect(bars).toHaveLength(3);
    expect(called(bars[0], "bg", "#ansi2")).toBe(true);
    watchlist.rows[AAPL.id].ref = 300;
    row = byId(render(), "row-stock:AAPL");
    bars = findAll(row, (n) => typeof n.elId === "string" && /^s\d+$/.test(n.elId));
    expect(called(bars[0], "bg", "#ansi1")).toBe(true);
  });

  it("downsamples the sparkline to the width there is, and follows on_size_change", async () => {
    const spark = Array.from({ length: 288 }, (_, i) => 100 + i);
    const data = fakeSources({ alpaca: { history: vi.fn(async () => history(387, 380, spark)) } });
    const { render, ui, cx } = await setup({ list: [AAPL], data });
    const count = (el) => findAll(byId(el, "row-stock:AAPL"), (n) => /^s\d+$/.test(String(n.elId))).length;
    const narrow = count(render());
    const root = render();
    root.handlers.on_size_change({ width: 900, height: 600 }, cx);
    expect(ui.width).toBe(900);
    expect(cx.notifies).toBeGreaterThan(0);
    const wide = count(render());
    expect(wide).toBeGreaterThan(narrow);
    const n = cx.notifies;
    render().handlers.on_size_change({ width: 900, height: 500 }, cx);
    expect(cx.notifies).toBe(n);
  });

  it("flashes a moved price", async () => {
    const { render, watchlist } = await setup();
    watchlist.live(AAPL.id, 210);
    const priceEl = findAll(byId(render(), "row-stock:AAPL"), (n) => n.kids[0] === "210.00")[0];
    expect(called(priceEl, "text_color", "#ansi2")).toBe(true);
  });

  it("marks ECB daily FX rates", async () => {
    const data = fakeSources({ fx: { history: vi.fn(async () => ({ ...history(1.1, 1.0), daily: true })) } });
    const { render } = await setup({ list: [EUR], data });
    expect(textOf(byId(render(), "row-fx:EUR/USD"))).toContain("+10.00% · daily");
  });

  it("says when there's nothing watched, and when Alpaca keys are missing", async () => {
    const { render, watchlist } = await setup({ list: [] });
    expect(textOf(render())).toContain("Nothing watched yet.");
    watchlist.keys = null;
    expect(textOf(render())).toContain("no Alpaca keys");
  });

  it("the ↻ button spins while busy and refreshes everything", async () => {
    const { render, watchlist, cx, data } = await setup();
    expect(called(findAll(byId(render(), "refresh"), (n) => n.tag === "svg")[0], "spin", 900)).toBe(false);
    byId(render(), "refresh").handlers.on_click({}, cx);
    expect(watchlist.busy).toBe(3);
    expect(called(findAll(byId(render(), "refresh"), (n) => n.tag === "svg")[0], "spin", 900)).toBe(true);
    await cx.flush();
    expect(data.binance.history).toHaveBeenCalledTimes(2);
  });

  it("row click opens the popup with the market and the row's numbers", async () => {
    const { render, cx } = await setup();
    byId(render(), "row-stock:AAPL").handlers.on_click({}, cx);
    byId(render(), "row-fx:EUR/USD").handlers.on_click({}, cx);
    expect(herdrMock.overlays).toEqual([
      {
        mod: "market-data",
        kind: "dialog",
        width: 680,
        height: 0.88,
        props: { market: AAPL, price: 200, ref: 190 },
      },
      { mod: "market-data", kind: "dialog", width: 680, height: 0.62, props: { market: EUR, price: null, ref: null } },
    ]);
    expect(openDetail(BTC, undefined)).toBe("ov3");
  });

  it("× removes the row without opening the popup", async () => {
    const { render, watchlist, cx } = await setup();
    byId(render(), "x-crypto:BTC/USDT").handlers.on_click({}, cx);
    expect(cx.stopped).toBe(true);
    expect(watchlist.has(BTC.id)).toBe(false);
    expect(herdrMock.overlays).toEqual([]);
    expect(findAll(render(), (n) => n.elId === "row-crypto:BTC/USDT")).toEqual([]);
  });

  it("shows the input's error under it, outlined red", async () => {
    const { render, input, cx } = await setup();
    input.set_value("sui crypto");
    input.emit("submit", cx);
    const field = byId(render(), "add-field");
    expect(textOf(field)).toBe(SEARCH_NOT_SYMBOL);
    expect(called(findAll(field, (n) => n.tag === "Input")[0], "border_color", "#ansi1")).toBe(true);
  });

  it("the ⓘ button shows the panel while hovered, and pins it on click", async () => {
    const { render, ui, cx } = await setup();
    expect(textOf(render())).not.toContain("How prices update");
    byId(render(), "info").handlers.on_hover(true, cx);
    expect(textOf(render())).toContain("How prices update");
    for (const [name] of INFO_LINES) expect(textOf(render())).toContain(name);
    byId(render(), "info").handlers.on_hover(false, cx);
    byId(render(), "info").handlers.on_click({}, cx);
    expect(ui.infoPinned).toBe(true);
    expect(textOf(render())).toContain("How prices update");
    expect(called(byId(render(), "info"), "bg", "#raised")).toBe(true);
  });
});

describe("suggestions dropdown", () => {
  it("typing searches; the dropdown lists suggestions, marking ones already added", async () => {
    const { render, input, cx } = await setup();
    input.type("apple", cx);
    await cx.flush();
    const box = byId(render(), "suggest");
    const first = byId(box, "sg-0");
    expect(textOf(first)).toBe("AAPL | Stock | Apple Inc. | ✓ added");
    expect(textOf(byId(box, "sg-1"))).not.toContain("✓ added");
    expect(called(first, "bg", "#selected")).toBe(true);
  });

  it("rows take no presses while it's open", async () => {
    const { render, input, cx } = await setup();
    input.type("apple", cx);
    await cx.flush();
    const el = render();
    expect(byId(el, "row-stock:AAPL").handlers.on_click).toBeUndefined();
    expect(byId(el, "x-stock:AAPL").handlers.on_click).toBeUndefined();
  });

  it("pressing a suggestion adds it and closes the dropdown", async () => {
    const { render, input, watchlist, cx } = await setup();
    input.type("apple", cx);
    await cx.flush();
    const sg = byId(render(), "sg-1");
    const sym = textOf(sg).split(" | ")[0];
    sg.handlers["on_mouse_down:left"]({}, cx);
    expect(cx.stopped).toBe(true);
    expect(watchlist.has(`stock:${sym}`)).toBe(true);
    expect(input.value()).toBe("");
    const el = render();
    expect(findAll(el, (n) => n.elId === "suggest")).toEqual([]);
    expect(byId(el, `row-stock:${sym}`)).toBeTruthy();
  });

  it("hovering moves the highlight; arrow keys on the field too", async () => {
    const { render, input, search, cx } = await setup();
    input.type("apple", cx);
    await cx.flush();
    byId(render(), "sg-2").handlers.on_hover(true, cx);
    expect(search.sel).toBe(2);
    byId(render(), "sg-2").handlers.on_hover(false, cx);
    expect(search.sel).toBe(2);
    byId(render(), "add-field").handlers.on_key_down({ key: "down" }, cx);
    const next = 3 % search.sugg.length;
    expect(search.sel).toBe(next);
    expect(called(byId(render(), `sg-${next}`), "bg", "#selected")).toBe(true);
  });

  it("says so when nothing matches", async () => {
    const data = fakeSources({ binance: { pairs: vi.fn(async () => new Set()) } });
    const { render, input, cx } = await setup({ data });
    input.type("qqqzz", cx);
    await cx.flush();
    expect(textOf(byId(render(), "suggest"))).toBe('No matches. Enter adds "QQQZZ" as typed.');
  });

  it("falls back to the hover colour without a selected one", async () => {
    const { render, input, cx } = await setup();
    delete herdrMock.theme.selected;
    input.type("apple", cx);
    await cx.flush();
    expect(called(byId(render(), "sg-0"), "bg", "#hover")).toBe(true);
  });
});
