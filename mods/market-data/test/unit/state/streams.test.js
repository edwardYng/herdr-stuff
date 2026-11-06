import { describe, it, expect, vi, beforeEach } from "vitest";
import { socketMock } from "../../../../../test-support/stubs/websocket.js";
import { createCx } from "../../../../../test-support/fake-cx.js";
import { Streams, messageText, BACKOFF_MS, BACKOFF_MAX_MS } from "../../../src/state/streams.js";
import { Watchlist, LIST_KEY } from "../../../src/state/watchlist.js";
import { fakeSources, memoryStorage, settle, KEYS } from "../../support/fake-sources.js";

const AAPL = { id: "stock:AAPL", kind: "stock", sym: "AAPL" };
const MSFT = { id: "stock:MSFT", kind: "stock", sym: "MSFT" };
const BTC = { id: "crypto:BTC/USDT", kind: "crypto", sym: "BTC/USDT" };
const ETH = { id: "crypto:ETH/USDT", kind: "crypto", sym: "ETH/USDT" };

beforeEach(() => socketMock.reset());

function make(list = [AAPL, MSFT, BTC, ETH]) {
  const data = fakeSources();
  const watchlist = new Watchlist({ data, storage: memoryStorage({ [LIST_KEY]: JSON.stringify(list) }) });
  watchlist.keys = KEYS;
  for (const m of list) watchlist.rows[m.id] = { price: 1, ref: 1 };
  const log = vi.fn();
  const streams = new Streams({ watchlist, data, log });
  return { watchlist, streams, log, cx: createCx() };
}

const miniTicker = (s, c, o) =>
  JSON.stringify({ stream: `${s.toLowerCase()}@miniTicker`, data: { e: "24hrMiniTicker", s, c, o } });

describe("crypto (Binance mini-ticker)", () => {
  it("connects to the combined stream for the listed pairs and feeds ticks to the watchlist", async () => {
    const { watchlist, streams, cx } = make();
    streams.restart("crypto", cx);
    await settle();
    expect(socketMock.connects.map((s) => s.url)).toEqual(["wss://binance.test/BTC/USDT,ETH/USDT"]);
    const ws = socketMock.connects[0];
    ws.push(miniTicker("ETHUSDT", "3500.5", "3400"));
    ws.push(miniTicker("DOGEUSDT", "1", "1"));
    ws.push("not json");
    await settle();
    expect(watchlist.rows[ETH.id]).toMatchObject({ price: 3500.5, ref: 3400, live: true });
    expect(watchlist.dirty).toBe(true);
  });

  it("decodes binary frames", async () => {
    const { watchlist, streams, cx } = make();
    streams.restart("crypto", cx);
    await settle();
    socketMock.connects[0].push(new TextEncoder().encode(miniTicker("BTCUSDT", "70000", "69000")));
    await settle();
    expect(watchlist.rows[BTC.id].price).toBe(70000);
  });
});

describe("stocks (Alpaca trades)", () => {
  it("authenticates, subscribes to the listed symbols and feeds trades; errors are logged", async () => {
    const { watchlist, streams, log, cx } = make();
    streams.restart("stock", cx);
    await settle();
    const ws = socketMock.connects[0];
    expect(ws.url).toBe("wss://alpaca.test/v2/iex");
    expect(ws.written.map((w) => JSON.parse(w))).toEqual([
      { action: "auth", key: "kid", secret: "sec" },
      { action: "subscribe", trades: ["AAPL", "MSFT"] },
    ]);
    ws.push(
      JSON.stringify([
        { T: "success", msg: "authenticated" },
        { T: "t", S: "MSFT", p: 412.5 },
      ]),
    );
    ws.push(JSON.stringify([{ T: "error", code: 406, msg: "connection limit exceeded" }]));
    await settle();
    expect(watchlist.rows[MSFT.id].price).toBe(412.5);
    expect(log).toHaveBeenCalledWith("alpaca stream: 406 connection limit exceeded");
  });

  it("opens nothing without keys or without markets of that kind", async () => {
    const { watchlist, streams, cx } = make([BTC]);
    streams.restart("stock", cx);
    watchlist.keys = null;
    watchlist.list.push(AAPL);
    streams.restart("stock", cx);
    await settle();
    expect(socketMock.connects).toEqual([]);
  });
});

describe("lifecycle", () => {
  it("a restart closes the old socket and stops its loop", async () => {
    const { watchlist, streams, cx } = make();
    streams.restart("crypto", cx);
    await settle();
    const first = socketMock.connects[0];
    watchlist.list = watchlist.list.filter((m) => m.id !== ETH.id);
    streams.restart("crypto", cx);
    await settle();
    expect(first.closed).toBe(true);
    expect(socketMock.connects[1].url).toBe("wss://binance.test/BTC/USDT");
    // A message the old socket still delivers is dropped.
    first.push(miniTicker("BTCUSDT", "123", "1"));
    await settle();
    expect(watchlist.rows[BTC.id].price).toBe(1);
  });

  it("a socket that connects after a restart is closed at once", async () => {
    const { streams, cx } = make();
    let release;
    streams.connect = vi.fn(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    streams.restart("crypto", cx);
    await settle();
    streams.gen.crypto++;
    const late = { close: vi.fn(async () => {}) };
    release(late);
    await settle();
    expect(late.close).toHaveBeenCalled();
    expect(streams.sockets.crypto).toBeUndefined();
  });

  it("reconnects with exponential backoff, 1s up to 60s, and resets it after a connection", async () => {
    const { streams, log, cx } = make();
    socketMock.fail = new Error("refused");
    const waits = [];
    cx.sleep = async (ms) => {
      waits.push(ms);
      if (waits.length === 9) socketMock.fail = null;
    };
    streams.restart("crypto", cx);
    await settle();
    await settle();
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(BACKOFF_MS).toBe(1000);
    expect(BACKOFF_MAX_MS).toBe(60000);
    expect(log).toHaveBeenCalledWith("crypto stream: refused; retrying in 1s");
    expect(socketMock.connects).toHaveLength(1);

    // The connection drops: the next wait starts from 1s again.
    const ws = socketMock.connects[0];
    ws.read = async () => {
      throw new Error("closed");
    };
    ws.push("x"); // wakes the pending read; the next one throws
    await settle();
    await settle();
    expect(waits[9]).toBe(1000);
    await streams.close();
  });

  it("an error after a restart ends the old loop quietly", async () => {
    const { streams, log, cx } = make();
    socketMock.fail = new Error("refused");
    cx.sleep = () => new Promise(() => {});
    streams.restart("crypto", cx);
    streams.gen.crypto++;
    await settle();
    expect(log).not.toHaveBeenCalled();
  });

  it("close stops both loops and closes their sockets", async () => {
    const { streams, cx } = make();
    streams.restart("stock", cx);
    streams.restart("crypto", cx);
    await settle();
    expect(socketMock.connects).toHaveLength(2);
    await streams.close();
    expect(socketMock.connects.every((s) => s.closed)).toBe(true);
    expect(streams.sockets).toEqual({});
    expect(streams.gen).toEqual({ stock: 2, crypto: 2 });
  });
});

describe("messageText", () => {
  it("passes text through and decodes bytes, with or without TextDecoder", () => {
    expect(messageText("hi")).toBe("hi");
    const bytes = new TextEncoder().encode("abc");
    expect(messageText(bytes)).toBe("abc");
    vi.stubGlobal("TextDecoder", undefined);
    try {
      expect(messageText(bytes)).toBe("abc");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
