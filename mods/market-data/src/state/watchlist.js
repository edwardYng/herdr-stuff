// The watchlist: which markets are followed (persisted), what each row shows (price, change
// reference, sparkline, flash, error), and the refresh/poll cycle that keeps them current.
import { parseMarket } from "../domain/markets.js";
import { errorLabel } from "../data/http.js";

/** @typedef {import("../domain/markets.js").Market} Market */
/** @typedef {import("../domain/markets.js").MarketKind} MarketKind */
/** @typedef {import("../data/index.js").DataSources} DataSources */
/** @typedef {import("../data/alpaca.js").AlpacaKeys} AlpacaKeys */
/** @typedef {import("../data/yahoo-session.js").StorageLike} StorageLike */
/** @typedef {import("gpui-kit").Context} Context */
/**
 * What a row shows. `ref`: what the % change is measured against. `flash`: the direction of the
 * last price change, drawn for FLASH_MS after `flashAt`. `live`/`liveAt`: a streamed tick arrived
 * (and when). `daily`: FX from ECB daily rates (Yahoo failed). `err`: shown instead of a price.
 * @typedef {{ price?: number, ref?: number, spark?: number[], err?: string, flash?: "up" | "down",
 *   flashAt?: number, live?: boolean, liveAt?: number, daily?: boolean }} Row
 */

/** Sparklines (and everything else) are re-fetched this often. */
export const HISTORY_MS = 5 * 60e3;
/** Prices are polled at least this often (streams tick in between). */
export const REFRESH_MS = 15e3;
/** Bursts of streamed ticks are coalesced into one redraw this often. */
export const PAINT_MS = 250;
/** How long a price stays green/red after it changed. */
export const FLASH_MS = 700;
/** A streamed tick this recent beats the history's last price on a refresh. */
export const LIVE_KEEP_MS = 60e3;
/** localStorage key of the list. */
export const LIST_KEY = "list";
/** What a new tile follows. */
export const DEFAULT_LIST = ["AAPL", "BTC/USDT", "EUR/USD"];

export class Watchlist {
  /**
   * @param {{ data: DataSources, storage?: StorageLike | null, now?: () => number }} deps
   */
  constructor({ data, storage = null, now = Date.now }) {
    this.data = data;
    this.storage = storage;
    this.now = now;
    /** @type {Market[]} */
    this.list = this.load();
    /** @type {Record<string, Row>} id → row */
    this.rows = {};
    /** @type {AlpacaKeys | null | undefined} undefined: not read yet; null: missing */
    this.keys = undefined;
    this.checkingKeys = false;
    /** Fetches running (the ↻ button spins while > 0). */
    this.busy = 0;
    /** A tick arrived since the last paint. */
    this.dirty = false;
    /**
     * Called when the markets of a streamed kind change (added, removed, keys arrived): the
     * streams restart that kind's socket. Set by the owner.
     * @type {(kind: "stock" | "crypto", cx: Context) => void}
     */
    this.onStreamChange = () => {};
  }

  /** @returns {Market[]} */
  load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(LIST_KEY) ?? "null");
      if (Array.isArray(saved)) return saved;
    } catch {
      // unreadable: start over with the defaults
    }
    return DEFAULT_LIST.map(parseMarket);
  }

  save() {
    try {
      this.storage?.setItem(LIST_KEY, JSON.stringify(this.list));
    } catch {
      // not persisted this time
    }
  }

  /** @param {MarketKind} kind */
  of(kind) {
    return this.list.filter((m) => m.kind === kind);
  }

  /** @param {string} id */
  has(id) {
    return this.list.some((m) => m.id === id);
  }

  /**
   * Starts the cycle: reads the Alpaca keys, loads every row, opens the streams, and sets the
   * poll, history and paint timers.
   * @param {Context} cx
   */
  start(cx) {
    cx.spawn(async (cx) => {
      this.keys = await this.data.alpacaKeys();
      this.refreshAll(cx);
      this.onStreamChange("stock", cx);
      this.onStreamChange("crypto", cx);
    });
    cx.timer.every(REFRESH_MS, (cx) => this.poll(cx));
    cx.timer.every(HISTORY_MS, (cx) => this.refreshAll(cx));
    cx.timer.every(PAINT_MS, (cx) => this.paint(cx));
  }

  /**
   * Redraws when a tick arrived, or while a flash is fading.
   * @param {Context} cx
   */
  paint(cx) {
    const t = this.now();
    const flashing = Object.values(this.rows).some((r) => r.flash && t - r.flashAt < FLASH_MS + PAINT_MS);
    if (this.dirty || flashing) {
      this.dirty = false;
      cx.notify();
    }
  }

  /**
   * Adds a market (if it isn't there yet), loads it and restarts its stream.
   * @param {Market} m
   * @param {Context} cx
   * @returns {boolean} whether it was added
   */
  add(m, cx) {
    if (this.has(m.id)) return false;
    this.list.push(m);
    this.save();
    this.refreshOne(m, cx);
    if (m.kind !== "fx") this.onStreamChange(m.kind, cx);
    cx.notify();
    return true;
  }

  /**
   * @param {string} id
   * @param {Context} cx
   */
  remove(id, cx) {
    const m = this.list.find((x) => x.id === id);
    this.list = this.list.filter((x) => x.id !== id);
    delete this.rows[id];
    this.save();
    if (m && m.kind !== "fx") this.onStreamChange(m.kind, cx);
    cx.notify();
  }

  // ---- history / polling ---------------------------------------------------

  /** @param {Context} cx */
  refreshAll(cx) {
    for (const m of this.list) this.refreshOne(m, cx);
  }

  /** @param {MarketKind} kind @param {Context} cx */
  refreshKind(kind, cx) {
    for (const m of this.of(kind)) this.refreshOne(m, cx);
  }

  /**
   * Every REFRESH_MS: FX, all stocks in one request, and the Alpaca keys while they're missing.
   * A streamed trade newer than REFRESH_MS isn't stepped back by the poll's (older) price.
   * @param {Context} cx
   */
  poll(cx) {
    if (this.keys === null) {
      this.checkKeys(cx);
      this.refreshKind("fx", cx);
      return;
    }
    this.refreshKind("fx", cx);
    const stocks = this.of("stock");
    const keys = this.keys;
    if (!stocks.length || !keys) return;
    this.track(cx, async (cx) => {
      const q = await this.data.alpaca.quotes(
        stocks.map((m) => m.sym),
        keys,
      );
      for (const m of stocks) {
        const row = this.rows[m.id];
        const quote = q[m.sym];
        if (!row || !quote) continue;
        const fresh = row.live && this.now() - row.liveAt < REFRESH_MS;
        if (!fresh && quote.price != null) this.tick(row, quote.price);
        if (quote.ref) row.ref = quote.ref;
      }
      cx.notify();
    });
  }

  /**
   * Keys set after the tile started: picks them up without a restart.
   * @param {Context} cx
   */
  checkKeys(cx) {
    if (this.checkingKeys) return;
    this.checkingKeys = true;
    cx.spawn(async (cx) => {
      const keys = await this.data.alpacaKeys().catch(() => null);
      this.checkingKeys = false;
      if (!keys) return;
      this.keys = keys;
      this.refreshKind("stock", cx);
      this.onStreamChange("stock", cx);
      cx.notify();
    });
  }

  /**
   * The ↻ button: everything, sparklines included (and the keys, if missing).
   * @param {Context} cx
   */
  refreshNow(cx) {
    if (this.keys === null) this.checkKeys(cx);
    this.refreshAll(cx);
    cx.notify();
  }

  /**
   * Runs a fetch while counting it in `busy`. Errors end it quietly; the view is redrawn after.
   * @param {Context} cx
   * @param {(cx: Context) => Promise<void>} body
   */
  track(cx, body) {
    this.busy++;
    cx.spawn(async (cx) => {
      try {
        await body(cx);
      } catch {
        // the row keeps what it had
      } finally {
        this.busy--;
        cx.notify();
      }
    });
  }

  /**
   * Loads a market's history: price, change reference, sparkline. A failure only shows on a row
   * that has no price yet ("not found" for a 4xx, else "offline").
   * @param {Market} m
   * @param {Context} cx
   */
  refreshOne(m, cx) {
    this.track(cx, async (cx) => {
      const row = (this.rows[m.id] ??= {});
      try {
        if (m.kind === "stock" && !this.keys) {
          row.err = this.keys === null ? "set Alpaca keys" : "";
          cx.notify();
          return;
        }
        const h =
          m.kind === "stock"
            ? await this.data.alpaca.history(m.sym, this.keys)
            : m.kind === "crypto"
              ? await this.data.binance.history(m.sym)
              : await this.data.fx.history(m.sym);
        if (!this.has(m.id)) return;
        // A live tick may be newer than the history's last price: keep it.
        const live = row.live && this.now() - row.liveAt < LIVE_KEEP_MS;
        this.tick(row, live ? row.price : h.price);
        row.ref = m.kind === "crypto" && row.ref ? row.ref : h.ref;
        row.spark = h.spark;
        row.daily = h.daily;
        row.err = "";
      } catch (e) {
        if (row.price == null) row.err = errorLabel(e);
      }
      cx.notify();
    });
  }

  // ---- ticks -----------------------------------------------------------------

  /**
   * A new price for a row: flashes when it moved, and becomes the sparkline's last point.
   * @param {Row} row
   * @param {number} price
   */
  tick(row, price) {
    if (row.price != null && price !== row.price) {
      row.flash = price > row.price ? "up" : "down";
      row.flashAt = this.now();
    }
    row.price = price;
    if (row.spark?.length) row.spark[row.spark.length - 1] = price;
  }

  /**
   * A streamed tick. Rows that aren't loaded (or were removed) ignore it. Drawn at the next paint.
   * @param {string} id
   * @param {number} price
   * @param {number} [ref] crypto: the 24h open
   */
  live(id, price, ref) {
    const row = this.rows[id];
    if (!row) return;
    this.tick(row, price);
    if (ref) row.ref = ref;
    row.live = true;
    row.liveAt = this.now();
    this.dirty = true;
  }

  /**
   * Whether a row's price is flashing now, and which way.
   * @param {Row} row
   * @returns {"up" | "down" | null}
   */
  flashOf(row) {
    return row.flash && this.now() - row.flashAt < FLASH_MS ? row.flash : null;
  }
}
