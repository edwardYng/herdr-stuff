// Live prices: Alpaca's trade stream (stocks) and Binance's mini-ticker stream (crypto). One loop
// per kind, reconnecting with backoff; a restart (the list changed) bumps the kind's generation,
// which ends the old loop at its next step. Ticks go to the watchlist.
import { WebSocket } from "websocket";
import { binanceSymbol } from "../domain/markets.js";
import { parseAlpacaMessages, parseBinanceTicker } from "../domain/messages.js";

/** @typedef {import("../data/index.js").DataSources} DataSources */
/** @typedef {import("./watchlist.js").Watchlist} Watchlist */
/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("websocket").WebSocketSocket} Socket */
/** @typedef {"stock" | "crypto"} StreamKind */

/** First wait after a failure; doubled each time up to BACKOFF_MAX_MS. */
export const BACKOFF_MS = 1000;
export const BACKOFF_MAX_MS = 60e3;

/**
 * A websocket message as text (binary frames are UTF-8).
 * @param {string | Uint8Array} msg
 * @returns {string}
 */
export function messageText(msg) {
  if (typeof msg === "string") return msg;
  // TextDecoder may be missing in Herdr's runtime (it isn't in ES2022's lib either).
  const Decoder = /** @type {any} */ (globalThis).TextDecoder;
  if (Decoder) return new Decoder().decode(msg);
  return String.fromCharCode(...msg);
}

export class Streams {
  /**
   * @param {{ watchlist: Watchlist, data: DataSources,
   *   connect?: (url: string) => Promise<Socket>, log?: (msg: string) => void }} deps
   */
  constructor({ watchlist, data, connect = (url) => WebSocket.connect(url), log = (msg) => console.log(msg) }) {
    this.watchlist = watchlist;
    this.data = data;
    this.connect = connect;
    this.log = log;
    /** @type {Record<StreamKind, number>} */
    this.gen = { stock: 0, crypto: 0 };
    /** @type {Partial<Record<StreamKind, Socket>>} */
    this.sockets = {};
  }

  /**
   * (Re)connects a kind's stream for the markets listed now; the old one stops. Nothing is opened
   * for an empty kind, or for stocks without Alpaca keys.
   * @param {StreamKind} kind
   * @param {Context} cx
   */
  restart(kind, cx) {
    const gen = ++this.gen[kind];
    const old = this.sockets[kind];
    delete this.sockets[kind];
    old?.close().catch(() => {});
    const syms = this.watchlist.of(kind).map((m) => m.sym);
    if (!syms.length || (kind === "stock" && !this.watchlist.keys)) return;
    cx.spawn((cx) => this.run(kind, gen, syms, cx));
  }

  /**
   * The loop for one generation: connect, (Alpaca: auth + subscribe), read until it fails, wait,
   * reconnect. Ends as soon as the generation is stale.
   * @param {StreamKind} kind
   * @param {number} gen
   * @param {string[]} syms
   * @param {Context} cx the task's own context
   */
  async run(kind, gen, syms, cx) {
    const current = () => gen === this.gen[kind];
    let backoff = BACKOFF_MS;
    while (current()) {
      try {
        const url = kind === "stock" ? this.data.alpacaStream : this.data.binance.streamUrl(syms);
        const ws = await this.connect(url);
        if (!current()) {
          ws.close().catch(() => {});
          return;
        }
        this.sockets[kind] = ws;
        if (kind === "stock") {
          const keys = this.watchlist.keys;
          await ws.write(JSON.stringify({ action: "auth", key: keys.key, secret: keys.secret }));
          await ws.write(JSON.stringify({ action: "subscribe", trades: syms }));
        }
        backoff = BACKOFF_MS;
        while (current()) {
          const msg = await ws.read();
          if (!current()) return;
          this.handle(kind, messageText(msg));
        }
        return;
      } catch (e) {
        if (!current()) return;
        this.log(`${kind} stream: ${/** @type {any} */ (e)?.message ?? e}; retrying in ${backoff / 1000}s`);
      }
      await cx.sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }

  /**
   * One message → ticks for the watchlist.
   * @param {StreamKind} kind
   * @param {string} text
   */
  handle(kind, text) {
    if (kind === "crypto") {
      const t = parseBinanceTicker(text);
      const m = t && this.watchlist.of("crypto").find((m) => binanceSymbol(m.sym) === t.sym);
      if (m) this.watchlist.live(m.id, t.price, t.ref);
      return;
    }
    for (const e of parseAlpacaMessages(text)) {
      if (e.T === "t") this.watchlist.live(`stock:${e.S}`, e.p);
      else if (e.T === "error") this.log(`alpaca stream: ${e.code} ${e.msg}`);
    }
  }

  /** Stops both loops and closes their sockets. */
  async close() {
    this.gen.stock++;
    this.gen.crypto++;
    const open = Object.values(this.sockets);
    this.sockets = {};
    await Promise.all(open.map((s) => s.close().catch(() => {})));
  }
}
