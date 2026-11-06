// The add box: what's typed, its error, and the autocomplete under it (Yahoo search + Binance
// pairs, debounced, newest answer wins, cached), with a highlight the arrow keys move.
import { parseMarket } from "../domain/markets.js";
import { buildSuggestions, parseQuery, searchPlan } from "../domain/search.js";

/** @typedef {import("../domain/markets.js").Market} Market */
/** @typedef {import("../domain/search.js").Suggestion} Suggestion */
/** @typedef {import("../data/index.js").DataSources} DataSources */
/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("gpui-base").InputState} InputState */

/** Wait this long after a keystroke before searching. */
export const DEBOUNCE_MS = 150;
/** After the box loses focus, the dropdown closes this much later (so a press on it still lands). */
export const BLUR_CLOSE_MS = 200;
export const PLACEHOLDER = "Search  AAPL · sui crypto · EUR/USD";
export const SEARCH_NOT_SYMBOL = "Pick a suggestion: that's a search, not a symbol";

/** @type {Record<string, string>} */
const TYPE_NAMES = { Crypto: "crypto", FX: "FX", ETF: "ETF", Stock: "stock" };

export class Search {
  /**
   * @param {{ input: InputState, data: DataSources, onPick: (m: Market, cx: Context) => void }} deps
   *   onPick: add the chosen market (the box is cleared and the dropdown closed first).
   */
  constructor({ input, data, onPick }) {
    this.input = input;
    this.data = data;
    this.onPick = onPick;
    /** Shown under the box in red. */
    this.err = "";
    /** @type {Suggestion[]} */
    this.sugg = [];
    /** The highlighted suggestion (Enter adds it); -1: none. */
    this.sel = -1;
    this.open = false;
    this.focused = false;
    this.seq = 0;
    /** @type {Record<string, Suggestion[]>} upper-cased text → answer */
    this.cache = {};

    input.on("submit", (_e, cx) => this.submit(cx));
    input.on("change", (_e, cx) => {
      this.err = "";
      this.search(cx);
      cx.notify();
    });
    input.on("focus", (_e, cx) => this.focus(cx));
    input.on("blur", (_e, cx) => this.blur(cx));
  }

  text() {
    return this.input.value();
  }

  /** Closes the dropdown and drops any answer still on its way. */
  close() {
    this.seq++;
    this.sugg = [];
    this.sel = -1;
    this.open = false;
  }

  /** @param {Suggestion[]} list */
  show(list) {
    this.sugg = list;
    this.sel = list.length ? 0 : -1;
    this.open = true;
  }

  /**
   * On each keystroke: search, debounced; the newest answer wins. Explicit forms ("BTC/USDT",
   * "stock:…") skip it, since they already say exactly what to add.
   * @param {Context} cx
   */
  search(cx) {
    const q = this.text().trim();
    if (!q || q.includes("/") || q.includes(":")) {
      this.close();
      return;
    }
    const seq = ++this.seq;
    const key = q.toUpperCase();
    if (this.cache[key]) {
      this.show(this.cache[key]);
      return;
    }
    cx.spawn(async (cx) => {
      await cx.sleep(DEBOUNCE_MS);
      if (seq !== this.seq) return;
      try {
        const list = await this.lookup(q);
        this.cache[key] = list;
        if (seq === this.seq) this.show(list);
      } catch {
        if (seq === this.seq) {
          this.sugg = [];
          this.open = false;
        }
      }
      cx.notify();
    });
  }

  /**
   * Suggestions for a query: Yahoo's hits (a failure leaves Binance's matches) + Binance's pairs.
   * @param {string} q
   * @returns {Promise<Suggestion[]>}
   * @throws Error("offline") when neither source answered
   */
  async lookup(q) {
    const { terms, quotesCount } = searchPlan(q);
    const pairs = this.data.binance.pairs();
    /** @type {any[]} */
    let quotes = [];
    try {
      quotes = await this.data.yahoo.search(terms, quotesCount);
    } catch {
      // Binance can still answer
    }
    return buildSuggestions({ text: q, quotes, pairs: await pairs });
  }

  /**
   * Up/Down move the highlight (wrapping), Escape closes. Enter is the input's own submit. The key
   * only stops here when it did something.
   * @param {KeyEvent} e
   * @param {Context} cx
   */
  key(e, cx) {
    if (!this.open || !this.sugg.length) return;
    const n = this.sugg.length;
    if (e.key === "down") this.sel = (this.sel + 1) % n;
    else if (e.key === "up") this.sel = (this.sel - 1 + n) % n;
    else if (e.key === "escape") this.open = false;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** @param {number} i @param {Context} cx */
  highlight(i, cx) {
    if (this.sel === i) return;
    this.sel = i;
    cx.notify();
  }

  /** @param {Context} cx */
  focus(cx) {
    this.focused = true;
    if (this.sugg.length && this.text().trim()) {
      this.open = true;
      cx.notify();
    }
  }

  /** @param {Context} cx */
  blur(cx) {
    this.focused = false;
    cx.spawn(async (cx) => {
      await cx.sleep(BLUR_CLOSE_MS);
      if (!this.focused && this.open) {
        this.open = false;
        cx.notify();
      }
    });
  }

  /**
   * Enter: the highlighted suggestion; else, unless it's a search with a type word ("sui crypto"),
   * the text read as a symbol.
   * @param {Context} cx
   */
  submit(cx) {
    const pick = this.open ? this.sugg[this.sel] : null;
    if (pick) return this.choose(pick.market, cx);
    const text = this.text();
    if (parseQuery(text).type) {
      this.err = SEARCH_NOT_SYMBOL;
      cx.notify();
      return;
    }
    const m = parseMarket(text);
    if (!m) {
      this.err = `Can't read "${text.trim()}"`;
      cx.notify();
      return;
    }
    this.choose(m, cx);
  }

  /**
   * Adds a market: closes the dropdown, clears the box, hands it to onPick.
   * @param {Market} m
   * @param {Context} cx
   */
  choose(m, cx) {
    this.close();
    this.input.set_value("");
    this.onPick(m, cx);
    cx.notify();
  }

  /** What the open dropdown says when there's nothing to suggest. */
  emptyMessage() {
    const { terms, type } = parseQuery(this.text());
    return type
      ? `No ${TYPE_NAMES[type]} matches for "${terms}".`
      : `No matches. Enter adds "${this.text().trim().toUpperCase()}" as typed.`;
  }
}
