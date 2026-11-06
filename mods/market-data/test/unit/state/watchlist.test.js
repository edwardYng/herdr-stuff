import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCx } from "../../../../../test-support/fake-cx.js";
import {
  Watchlist,
  DEFAULT_LIST,
  REFRESH_MS,
  HISTORY_MS,
  PAINT_MS,
  FLASH_MS,
  LIST_KEY,
} from "../../../src/state/watchlist.js";
import { HttpError } from "../../../src/data/http.js";
import { fakeSources, memoryStorage, history, KEYS } from "../../support/fake-sources.js";

const AAPL = { id: "stock:AAPL", kind: "stock", sym: "AAPL" };
const BTC = { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" };
const ETH = { id: "crypto:ETH/USDT", kind: "crypto", sym: "ETH/USDT" };
const EUR = { id: "fx:EUR/USD", kind: "fx", sym: "EUR/USD" };
const MSFT = { id: "stock:MSFT", kind: "stock", sym: "MSFT" };

let now;
beforeEach(() => {
  now = 1_000_000;
});

/** A watchlist over fakes; `list` is stored first when given. */
function make({ list, data = fakeSources(), storage } = {}) {
  storage ??= memoryStorage(list ? { [LIST_KEY]: JSON.stringify(list) } : {});
  const w = new Watchlist({ data, storage, now: () => now });
  const restarts = [];
  w.onStreamChange = (kind) => restarts.push(kind);
  return { w, data, storage, restarts, cx: createCx() };
}

describe("the list", () => {
  it("starts with AAPL, BTC/USDT and EUR/USD", () => {
    const { w } = make();
    expect(DEFAULT_LIST).toEqual(["AAPL", "BTC/USDT", "EUR/USD"]);
    expect(w.list).toEqual([AAPL, BTC, EUR]);
  });

  it("loads the saved list, and falls back to the defaults when it's unreadable", () => {
    expect(make({ list: [MSFT] }).w.list).toEqual([MSFT]);
    expect(make({ storage: memoryStorage({ list: "{nope" }) }).w.list).toEqual([AAPL, BTC, EUR]);
    expect(make({ storage: memoryStorage({ list: '"x"' }) }).w.list).toEqual([AAPL, BTC, EUR]);
    expect(new Watchlist({ data: fakeSources() }).list).toHaveLength(3);
  });

  it("of / has", () => {
    const { w } = make();
    expect(w.of("crypto")).toEqual([BTC]);
    expect(w.has("fx:EUR/USD")).toBe(true);
    expect(w.has("stock:MSFT")).toBe(false);
  });

  it("add: saves, loads the row and restarts that kind's stream; a duplicate is ignored", async () => {
    const { w, cx, storage, restarts, data } = make({ list: [AAPL] });
    w.keys = KEYS;
    expect(w.add(ETH, cx)).toBe(true);
    await cx.flush();
    expect(JSON.parse(storage.data.get(LIST_KEY))).toEqual([AAPL, ETH]);
    expect(data.binance.history).toHaveBeenCalledWith("ETH/USDT");
    expect(w.rows[ETH.id].price).toBe(50000);
    expect(restarts).toEqual(["crypto"]);
    expect(w.add(ETH, cx)).toBe(false);
    expect(w.list).toHaveLength(2);
    w.add(EUR, cx);
    expect(restarts).toEqual(["crypto"]);
    expect(cx.notifies).toBeGreaterThan(0);
  });

  it("remove: drops the row, saves and restarts the stream (not for FX)", () => {
    const { w, cx, storage, restarts } = make({ list: [AAPL, BTC, EUR] });
    w.rows[BTC.id] = { price: 1 };
    w.remove(BTC.id, cx);
    expect(w.list).toEqual([AAPL, EUR]);
    expect(w.rows[BTC.id]).toBeUndefined();
    expect(JSON.parse(storage.data.get(LIST_KEY))).toEqual([AAPL, EUR]);
    expect(restarts).toEqual(["crypto"]);
    w.remove(EUR.id, cx);
    w.remove("stock:NOPE", cx);
    expect(restarts).toEqual(["crypto"]);
  });

  it("survives storage that throws on write", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    };
    const { w, cx } = make({ storage });
    expect(() => w.remove(EUR.id, cx)).not.toThrow();
  });
});

describe("start", () => {
  it("reads the keys, loads every row, opens both streams and sets the timers", async () => {
    const { w, cx, data, restarts } = make();
    w.start(cx);
    await cx.flush();
    expect(w.keys).toEqual(KEYS);
    expect(data.alpaca.history).toHaveBeenCalledWith("AAPL", KEYS);
    expect(data.binance.history).toHaveBeenCalledWith("BTC/USDT");
    expect(data.fx.history).toHaveBeenCalledWith("EUR/USD");
    expect(w.rows[AAPL.id]).toMatchObject({ price: 200, ref: 190, err: "" });
    expect(w.rows[EUR.id]).toMatchObject({ price: 1.1, ref: 1.09 });
    expect(restarts).toEqual(["stock", "crypto"]);
    expect(cx.timers.map((t) => t.ms).sort((a, b) => a - b)).toEqual([PAINT_MS, REFRESH_MS, HISTORY_MS]);
    expect(w.busy).toBe(0);

    data.fx.history.mockClear();
    cx.tick(HISTORY_MS);
    await cx.flush();
    expect(data.fx.history).toHaveBeenCalledTimes(1);
  });

  it("without keys, stock rows say so; before the keys are read, they say nothing", async () => {
    const { w, cx } = make({ list: [AAPL], data: fakeSources({ alpacaKeys: vi.fn(async () => null) }) });
    w.refreshOne(AAPL, cx);
    await cx.flush();
    expect(w.rows[AAPL.id].err).toBe("");
    w.start(cx);
    await cx.flush();
    expect(w.keys).toBeNull();
    expect(w.rows[AAPL.id].err).toBe("set Alpaca keys");
  });
});

describe("refreshOne", () => {
  it("labels a failure on a row without a price: 4xx → not found, else offline", async () => {
    const data = fakeSources({
      binance: { history: vi.fn(async () => Promise.reject(new HttpError(400))) },
      fx: { history: vi.fn(async () => Promise.reject(new Error("boom"))) },
    });
    const { w, cx } = make({ list: [BTC, EUR], data });
    w.refreshAll(cx);
    await cx.flush();
    expect(w.rows[BTC.id].err).toBe("not found");
    expect(w.rows[EUR.id].err).toBe("offline");
  });

  it("keeps the last price (and no error) when a later refresh fails", async () => {
    const data = fakeSources();
    const { w, cx } = make({ list: [EUR], data });
    w.refreshOne(EUR, cx);
    await cx.flush();
    data.fx.history.mockRejectedValueOnce(new Error("down"));
    w.refreshOne(EUR, cx);
    await cx.flush();
    expect(w.rows[EUR.id]).toMatchObject({ price: 1.1, err: "" });
  });

  it("marks ECB daily rates", async () => {
    const data = fakeSources({ fx: { history: vi.fn(async () => ({ ...history(1.1, 1.0), daily: true })) } });
    const { w, cx } = make({ list: [EUR], data });
    w.refreshOne(EUR, cx);
    await cx.flush();
    expect(w.rows[EUR.id].daily).toBe(true);
  });

  it("a live tick under a minute old beats the history's price; crypto keeps its streamed ref", async () => {
    const { w, cx } = make({ list: [BTC] });
    w.rows[BTC.id] = {};
    w.live(BTC.id, 51000, 48000);
    now += 30e3;
    w.refreshOne(BTC, cx);
    await cx.flush();
    expect(w.rows[BTC.id]).toMatchObject({ price: 51000, ref: 48000, spark: [49999, 50000] });

    now += 60e3;
    w.refreshOne(BTC, cx);
    await cx.flush();
    expect(w.rows[BTC.id].price).toBe(50000);
  });

  it("ignores an answer for a market removed meanwhile", async () => {
    let release;
    const data = fakeSources({ fx: { history: vi.fn(() => new Promise((r) => (release = r))) } });
    const { w, cx } = make({ list: [EUR], data });
    w.refreshOne(EUR, cx);
    await Promise.resolve();
    expect(w.busy).toBe(1);
    w.list = [];
    release(history(1.2, 1.1));
    await cx.flush();
    expect(w.rows[EUR.id].price).toBeUndefined();
    expect(w.busy).toBe(0);
  });
});

describe("poll", () => {
  it("refreshes FX and every stock in one request", async () => {
    const data = fakeSources({
      alpaca: { quotes: vi.fn(async () => ({ AAPL: { price: 201, ref: 191 }, MSFT: { price: undefined, ref: 400 } })) },
    });
    const { w, cx } = make({ list: [AAPL, MSFT, EUR], data });
    w.keys = KEYS;
    w.rows[AAPL.id] = { price: 200, ref: 190 };
    w.rows[MSFT.id] = { price: 410 };
    w.poll(cx);
    await cx.flush();
    expect(data.alpaca.quotes).toHaveBeenCalledWith(["AAPL", "MSFT"], KEYS);
    expect(data.fx.history).toHaveBeenCalledWith("EUR/USD");
    expect(w.rows[AAPL.id]).toMatchObject({ price: 201, ref: 191, flash: "up" });
    expect(w.rows[MSFT.id]).toMatchObject({ price: 410, ref: 400 });
  });

  it("never steps back over a streamed trade newer than REFRESH_MS", async () => {
    const data = fakeSources({ alpaca: { quotes: vi.fn(async () => ({ AAPL: { price: 199, ref: 190 } })) } });
    const { w, cx } = make({ list: [AAPL], data });
    w.keys = KEYS;
    w.rows[AAPL.id] = { price: 200 };
    w.live(AAPL.id, 205);
    now += REFRESH_MS - 1;
    w.poll(cx);
    await cx.flush();
    expect(w.rows[AAPL.id].price).toBe(205);

    now += 2;
    w.poll(cx);
    await cx.flush();
    expect(w.rows[AAPL.id].price).toBe(199);
  });

  it("does nothing for stocks before the keys are read or without stocks", async () => {
    const { w, cx, data } = make({ list: [AAPL, EUR] });
    w.poll(cx);
    await cx.flush();
    expect(data.alpaca.quotes).not.toHaveBeenCalled();
    const other = make({ list: [EUR] });
    other.w.keys = KEYS;
    other.w.poll(other.cx);
    await other.cx.flush();
    expect(other.data.alpaca.quotes).not.toHaveBeenCalled();
  });

  it("a failed batch leaves the rows as they were", async () => {
    const data = fakeSources({ alpaca: { quotes: vi.fn(async () => Promise.reject(new Error("x"))) } });
    const { w, cx } = make({ list: [AAPL], data });
    w.keys = KEYS;
    w.rows[AAPL.id] = { price: 200 };
    w.poll(cx);
    await cx.flush();
    expect(w.rows[AAPL.id].price).toBe(200);
    expect(w.busy).toBe(0);
  });

  it("picks up Alpaca keys set later, once, and then loads the stocks and their stream", async () => {
    const alpacaKeys = vi.fn(async () => null);
    const { w, cx, data, restarts } = make({ list: [AAPL, EUR], data: fakeSources({ alpacaKeys }) });
    w.keys = null;
    w.poll(cx);
    w.poll(cx);
    await cx.flush();
    expect(alpacaKeys).toHaveBeenCalledTimes(1);
    expect(w.keys).toBeNull();
    expect(data.fx.history).toHaveBeenCalledTimes(2);

    alpacaKeys.mockResolvedValue(KEYS);
    w.poll(cx);
    await cx.flush();
    expect(w.keys).toEqual(KEYS);
    expect(data.alpaca.history).toHaveBeenCalledWith("AAPL", KEYS);
    expect(restarts).toEqual(["stock"]);
  });

  it("refreshNow reloads everything and checks for keys when missing", async () => {
    const alpacaKeys = vi.fn(async () => KEYS);
    const { w, cx, data } = make({ list: [BTC], data: fakeSources({ alpacaKeys }) });
    w.keys = null;
    w.refreshNow(cx);
    await cx.flush();
    expect(alpacaKeys).toHaveBeenCalled();
    expect(data.binance.history).toHaveBeenCalled();
    w.refreshNow(cx);
    await cx.flush();
    expect(alpacaKeys).toHaveBeenCalledTimes(1);
  });
});

describe("ticks", () => {
  it("flash up or down when the price moves, and become the sparkline's last point", () => {
    const { w } = make();
    const row = { price: 10, spark: [9, 10] };
    w.tick(row, 11);
    expect(row).toMatchObject({ price: 11, flash: "up", flashAt: now, spark: [9, 11] });
    now += 100;
    w.tick(row, 10.5);
    expect(row).toMatchObject({ flash: "down", flashAt: now });
    const first = {};
    w.tick(first, 5);
    expect(first).toEqual({ price: 5 });
    w.tick(first, 5);
    expect(first.flash).toBeUndefined();
  });

  it("flashOf: the direction while it lasts", () => {
    const { w } = make();
    const row = { price: 10 };
    expect(w.flashOf(row)).toBeNull();
    w.tick(row, 9);
    expect(w.flashOf(row)).toBe("down");
    now += FLASH_MS;
    expect(w.flashOf(row)).toBeNull();
  });

  it("live: updates a loaded row, marks it dirty for the next paint; unknown ids are ignored", () => {
    const { w, cx } = make();
    w.live("stock:NOPE", 1);
    expect(w.dirty).toBe(false);
    w.rows[BTC.id] = { price: 1, ref: 1 };
    w.live(BTC.id, 2, 0);
    expect(w.rows[BTC.id]).toMatchObject({ price: 2, ref: 1, live: true, liveAt: now });
    expect(w.dirty).toBe(true);

    w.paint(cx);
    expect(cx.notifies).toBe(1);
    expect(w.dirty).toBe(false);
    // still flashing: keeps painting until the flash is over
    now += FLASH_MS;
    w.paint(cx);
    expect(cx.notifies).toBe(2);
    now += PAINT_MS;
    w.paint(cx);
    expect(cx.notifies).toBe(2);
  });
});
