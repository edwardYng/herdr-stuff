// Market Data: a watchlist tile with live prices.
// Stocks via Alpaca (IEX), crypto via Binance, FX via Yahoo (Frankfurter fallback).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, settings, props, openOverlay } from "herdr";
import { WebSocket } from "websocket";
import {
  parseMarket, alpacaKeys, stockHistory, stockQuotes, cryptoHistory, fxHistory,
  ALPACA_STREAM, binanceStream, parseBinance, parseAlpaca, formatPrice, formatChange,
} from "./feeds.js";
import { searchMarkets, parseQuery } from "./yahoo.js";
import { Detail } from "./detail.js";

const HISTORY_MS = 5 * 60e3;   // re-fetch sparklines
const REFRESH_MS = 15e3;       // prices at least this often (streams tick in between)
const PAINT_MS = 250;          // coalesce bursts of ticks into one redraw
const FLASH_MS = 700;
const BAR_W = 3, BAR_GAP = 1;

/** Rough text width in px (the UI font is proportional; errs slightly wide). */
function textW(str, size) {
  let w = 0;
  for (const ch of str) w += ".,:·".includes(ch) ? 0.3 : /[0-9]/.test(ch) ? 0.6 : /[A-Z]/.test(ch) ? 0.68 : 0.55;
  return Math.ceil(w * size);
}

export default class Markets extends View {
  init(_props, cx) {
    // Opened again as the popup for one market (see openDetail): a different view entirely.
    const p = props();
    if (p?.market) { this.detail = new Detail(p, cx); return; }
    this.list = JSON.parse(localStorage.getItem("list") ?? "null") ??
      ["AAPL", "BTC/USDT", "EUR/USD"].map(parseMarket);
    this.rows = {};            // id → { price, ref, spark, err, flash, flashAt, daily }
    this.keys = undefined;     // undefined: not read yet; null: missing
    this.gen = { stock: 0, crypto: 0 };
    this.sockets = {};
    this.dirty = false;
    this.inputErr = "";

    // Autocomplete: Yahoo search results under the box (see search / suggestions).
    this.sugg = [];            // [{ market, name, type, exchange }]
    this.sel = -1;             // highlighted suggestion; Enter adds it
    this.suggOpen = false;
    this.searchSeq = 0;
    this.searchCache = {};
    this.focused = false;

    this.input = InputState.new({ placeholder: "Search  AAPL · sui crypto · EUR/USD" });
    this.input.on("submit", (_e, cx) => {
      const pick = this.suggOpen ? this.sugg[this.sel] : null;
      if (pick) this.addMarket(pick.market, cx);
      else if (parseQuery(this.input.value()).type) { this.inputErr = "Pick a suggestion: that's a search, not a symbol"; cx.notify(); }
      else this.add(this.input.value(), cx);
    });
    this.input.on("change", (_e, cx) => { this.inputErr = ""; this.search(cx); cx.notify(); });
    this.input.on("focus", (_e, cx) => {
      this.focused = true;
      if (this.sugg.length && this.input.value().trim()) { this.suggOpen = true; cx.notify(); }
    });
    // Close on blur, a beat later, so a press on a suggestion still lands.
    this.input.on("blur", (_e, cx) => {
      this.focused = false;
      cx.spawn(async (cx) => { await cx.sleep(200); if (!this.focused && this.suggOpen) { this.suggOpen = false; cx.notify(); } });
    });

    cx.spawn(async (cx) => {
      this.keys = await alpacaKeys();
      this.refreshAll(cx);
      this.restart("stock", cx);
      this.restart("crypto", cx);
    });
    cx.timer.every(REFRESH_MS, (cx) => this.poll(cx));
    cx.timer.every(HISTORY_MS, (cx) => this.refreshAll(cx));
    cx.timer.every(PAINT_MS, (cx) => {
      const flashing = Object.values(this.rows).some((r) => r.flash && Date.now() - r.flashAt < FLASH_MS + PAINT_MS);
      if (this.dirty || flashing) { this.dirty = false; cx.notify(); }
    });
  }

  async close() {
    if (this.detail) return;
    this.gen.stock++; this.gen.crypto++;
    await Promise.all(Object.values(this.sockets).map((s) => s.close().catch(() => {})));
  }

  // ---- list --------------------------------------------------------------

  save() { localStorage.setItem("list", JSON.stringify(this.list)); }
  of(kind) { return this.list.filter((m) => m.kind === kind); }

  add(text, cx) {
    const m = parseMarket(text);
    if (!m) { this.inputErr = `Can't read "${text.trim()}"`; cx.notify(); return; }
    this.addMarket(m, cx);
  }

  addMarket(m, cx) {
    this.closeSuggestions();
    this.input.set_value("");
    if (!this.list.some((x) => x.id === m.id)) {
      this.list.push(m);
      this.save();
      this.refreshOne(m, cx);
      if (m.kind !== "fx") this.restart(m.kind, cx);
    }
    cx.notify();
  }

  // ---- autocomplete --------------------------------------------------------

  closeSuggestions() { this.searchSeq++; this.sugg = []; this.sel = -1; this.suggOpen = false; }

  /** On each keystroke: Yahoo search, debounced, newest answer wins. Explicit forms (BTC/USDT,
   *  stock:…) skip it, since they already say exactly what to add. */
  search(cx) {
    const q = this.input.value().trim();
    if (!q || q.includes("/") || q.includes(":")) { this.closeSuggestions(); return; }
    const seq = ++this.searchSeq;
    const show = (list) => { this.sugg = list; this.sel = list.length ? 0 : -1; this.suggOpen = true; };
    const key = q.toUpperCase();
    if (this.searchCache[key]) { show(this.searchCache[key]); return; }
    cx.spawn(async (cx) => {
      await cx.sleep(150);
      if (seq !== this.searchSeq) return;
      try {
        const list = await searchMarkets(q);
        this.searchCache[key] = list;
        if (seq === this.searchSeq) show(list);
      } catch { if (seq === this.searchSeq) { this.sugg = []; this.suggOpen = false; } }
      cx.notify();
    });
  }

  /** Up/Down move the highlight, Escape closes. Enter is the input's own submit. */
  suggestKey(e, cx) {
    if (!this.suggOpen || !this.sugg.length) return;
    const n = this.sugg.length;
    if (e.key === "down") this.sel = (this.sel + 1) % n;
    else if (e.key === "up") this.sel = (this.sel - 1 + n) % n;
    else if (e.key === "escape") this.suggOpen = false;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** The dropdown, laid over the top of the list. */
  suggestions(t) {
    if (!this.suggOpen) return null;
    const box = v_flex().id("suggest").absolute().top(0).left(10).right(10).py(4).rounded(8).border_1()
      .border_color(t.border).bg(t.popover).shadow_lg();
    if (!this.sugg.length) {
      const { terms, type } = parseQuery(this.input.value());
      return box.child(div().px(10).py(6).text_size(11.5).text_color(t.dim)
        .child(type ? `No ${type === "Crypto" ? "crypto" : type === "FX" ? "FX" : type === "ETF" ? "ETF" : "stock"} matches for "${terms}".`
          : `No matches. Enter adds "${this.input.value().trim().toUpperCase()}" as typed.`));
    }
    return box.children(this.sugg.map((s, i) => {
      const on = i === this.sel;
      const have = this.list.some((x) => x.id === s.market.id);
      return h_flex().id(`sg-${i}`).mx(4).px(8).py(5).gap(8).rounded(6).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected ?? t.hover))
        .on_hover((h, cx) => { if (h && this.sel !== i) { this.sel = i; cx.notify(); } })
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.addMarket(s.market, cx); })
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().gap(6).items_center()
            .child(div().text_size(12).font_semibold().text_color(t.foreground).child(s.market.sym))
            .child(div().px(4).rounded(3).bg(t.raised).text_size(9.5).text_color(t.muted).child(s.type)))
          .child(div().text_size(10.5).text_color(t.muted).truncate().child(s.name)))
        .child(div().flex_shrink_0().text_size(10.5).text_color(t.dim).child(have ? "✓ added" : s.exchange));
    }));
  }

  remove(id, cx) {
    const m = this.list.find((x) => x.id === id);
    this.list = this.list.filter((x) => x.id !== id);
    delete this.rows[id];
    this.save();
    if (m && m.kind !== "fx") this.restart(m.kind, cx);
    cx.notify();
  }

  /** Clicking a row: a Yahoo Finance–style popup for that market. */
  openDetail(m) {
    const r = this.rows[m.id] ?? {};
    // FX has the shortest page on Yahoo too: a shorter dialog.
    return openOverlay({ mod: "market-data", kind: "dialog", width: 680, height: m.kind === "fx" ? 0.62 : 0.88,
      props: { market: m, price: r.price ?? null, ref: r.ref ?? null } });
  }

  // ---- history / polling ---------------------------------------------------

  refreshAll(cx) { for (const m of this.list) this.refreshOne(m, cx); }
  refreshKind(kind, cx) { for (const m of this.of(kind)) this.refreshOne(m, cx); }

  /** Every 15 s: FX, all stocks in one request, and Alpaca keys if still missing. */
  poll(cx) {
    if (this.keys === null) { this.checkKeys(cx); return this.refreshKind("fx", cx); }
    this.refreshKind("fx", cx);
    const stocks = this.of("stock");
    if (!stocks.length || !this.keys) return;
    this.track(cx, async (cx) => {
      const q = await stockQuotes(stocks.map((m) => m.sym), this.keys);
      for (const m of stocks) {
        const row = this.rows[m.id];
        if (!row || !q[m.sym]) continue;
        // Don't step back over a newer streamed trade.
        if (!(row.live && Date.now() - row.liveAt < REFRESH_MS)) this.tick(row, q[m.sym].price);
        if (q[m.sym].ref) row.ref = q[m.sym].ref;
      }
      cx.notify();
    });
  }

  /** Keys set after the tile started: pick them up without a restart. */
  checkKeys(cx) {
    if (this.checkingKeys) return;
    this.checkingKeys = true;
    cx.spawn(async (cx) => {
      const keys = await alpacaKeys();
      this.checkingKeys = false;
      if (!keys) return;
      this.keys = keys;
      this.refreshKind("stock", cx);
      this.restart("stock", cx);
      cx.notify();
    });
  }

  /** The ↻ button: everything, sparklines included. */
  refreshNow(cx) {
    if (this.keys === null) this.checkKeys(cx);
    this.refreshAll(cx);
    cx.notify();
  }

  /** Runs a fetch while counting it, so the ↻ button can show it's busy. */
  track(cx, body) {
    this.busy = (this.busy ?? 0) + 1;
    cx.spawn(async (cx) => {
      try { await body(cx); } catch {} finally { this.busy--; cx.notify(); }
    });
  }

  refreshOne(m, cx) {
    this.track(cx, async (cx) => {
      const row = (this.rows[m.id] ??= {});
      try {
        if (m.kind === "stock" && !this.keys) { row.err = this.keys === null ? "set Alpaca keys" : ""; cx.notify(); return; }
        const h = m.kind === "stock" ? await stockHistory(m.sym, this.keys)
          : m.kind === "crypto" ? await cryptoHistory(m.sym) : await fxHistory(m.sym);
        if (!this.list.some((x) => x.id === m.id)) return;
        // A live tick may be newer than the history's last price: keep it.
        const live = row.live && Date.now() - row.liveAt < 60e3;
        this.tick(row, live ? row.price : h.price);
        row.ref = m.kind === "crypto" && row.ref ? row.ref : h.ref;
        row.spark = h.spark;
        row.daily = h.daily;
        row.err = "";
      } catch (e) {
        if (row.price == null) row.err = /^4\d\d$/.test(e.message) ? "not found" : "offline";
      }
      cx.notify();
    });
  }

  tick(row, price) {
    if (row.price != null && price !== row.price) { row.flash = price > row.price ? "up" : "down"; row.flashAt = Date.now(); }
    row.price = price;
    if (row.spark?.length) row.spark[row.spark.length - 1] = price;
  }

  live(id, price, ref) {
    const row = this.rows[id];
    if (!row) return;
    this.tick(row, price);
    if (ref) row.ref = ref;
    row.live = true; row.liveAt = Date.now();
    this.dirty = true;
  }

  // ---- streams -------------------------------------------------------------

  /** (Re)connects the stream for a kind with the current list; the old one stops. */
  restart(kind, cx) {
    const gen = ++this.gen[kind];
    const old = this.sockets[kind];
    delete this.sockets[kind];
    old?.close().catch(() => {});
    const syms = this.of(kind).map((m) => m.sym);
    if (!syms.length || (kind === "stock" && !this.keys)) return;

    cx.spawn(async (cx) => {
      let backoff = 1000;
      while (gen === this.gen[kind]) {
        try {
          const ws = await WebSocket.connect(kind === "stock" ? ALPACA_STREAM : binanceStream(syms));
          if (gen !== this.gen[kind]) { ws.close().catch(() => {}); return; }
          this.sockets[kind] = ws;
          if (kind === "stock") {
            await ws.write(JSON.stringify({ action: "auth", key: this.keys.key, secret: this.keys.secret }));
            await ws.write(JSON.stringify({ action: "subscribe", trades: syms }));
          }
          backoff = 1000;
          while (gen === this.gen[kind]) {
            const msg = await ws.read();
            if (gen !== this.gen[kind]) return;
            const text = typeof msg === "string" ? msg : (typeof TextDecoder !== "undefined" ? new TextDecoder().decode(msg) : String.fromCharCode(...msg));
            if (kind === "crypto") {
              const t = parseBinance(text);
              if (t) this.live(`crypto:${this.of("crypto").find((m) => m.sym.replace("/", "") === t.sym)?.sym}`, t.price, t.ref);
            } else {
              for (const e of parseAlpaca(text)) {
                if (e.T === "t") this.live(`stock:${e.S}`, e.p);
                else if (e.T === "error") console.log(`alpaca stream: ${e.code} ${e.msg}`);
              }
            }
          }
        } catch (e) {
          if (gen !== this.gen[kind]) return;
          console.log(`${kind} stream: ${e?.message ?? e}; retrying in ${backoff / 1000}s`);
        }
        await cx.sleep(backoff);
        backoff = Math.min(backoff * 2, 60e3);
      }
    });
  }

  // ---- UI ------------------------------------------------------------------

  /** Bars are always BAR_W wide; a wider tile shows more of them, never fatter ones. */
  spark(values, color, width) {
    const n = Math.max(4, Math.floor((width + BAR_GAP) / (BAR_W + BAR_GAP)));
    const box = h_flex().flex_1().min_w(0).overflow_hidden().h(20).items_end().justify_end().gap(BAR_GAP);
    if (!values || values.length < 2) return box;
    // Newest on the right; downsample when there are more points than bars.
    const step = values.length / n;
    const pts = values.length <= n ? values
      : Array.from({ length: n }, (_, i) => values[Math.min(values.length - 1, Math.floor((i + 1) * step) - 1)]);
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    return box.children(pts.map((v, i) =>
      div().id(`s${i}`).w(BAR_W).flex_shrink_0().h(2 + ((v - lo) / span) * 18).rounded(1).bg(color).opacity(0.75)));
  }

  /** The ⓘ panel: how often each kind of price updates. */
  info(t) {
    const line = (name, text) => h_flex().gap(8).items_start()
      .child(div().w(52).flex_shrink_0().text_size(11).font_semibold().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).child(text));
    return v_flex().mx(10).mb(8).p(10).gap(7).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .child(div().text_size(11.5).font_semibold().text_color(t.foreground).child("How prices update"))
      .child(line("Crypto", "Live from Binance: every change, about once a second. % change is over the last 24 hours."))
      .child(line("Stocks", "Live trades from Alpaca (IEX exchange) while the market is open, plus a full check every 15s, which covers pre- and after-hours. % change is against the previous close."))
      .child(line("FX", "Every 15s from Yahoo Finance. If Yahoo is down, daily European Central Bank rates (marked \"daily\"). % change is against the previous close."))
      .child(line("Charts", "The bars show the last day in 5-minute steps and reload every 5 minutes. ↻ reloads everything now."));
  }

  render(cx) {
    if (this.detail) return this.detail.render(cx);
    const t = theme();
    const up = t.ansi2, down = t.ansi1;
    const header = h_flex().h(34).px(12).items_center().justify_between()
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Markets"))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(10.5).text_color(t.dim).child(this.keys === null ? "no Alpaca keys" : ""))
        .child(h_flex().id("refresh").w(22).h(22).rounded(6).items_center().justify_center().cursor_pointer()
          .text_color(this.busy ? t.foreground : t.muted)
          .hover((s) => s.bg(t.raised).text_color(t.foreground))
          .on_click((_e, cx) => this.refreshNow(cx))
          .child(this.busy ? svg("mods/market-data/refresh.svg").size(13).spin(900) : svg("mods/market-data/refresh.svg").size(13))));

    const field = v_flex().id("add-field").px(10).pb(8).gap(4)
      .on_key_down((e, cx) => this.suggestKey(e, cx))
      .child(Input.new(this.input).h(30).px(9).rounded(7).border_1()
        .border_color(this.inputErr ? down : t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .when(Boolean(this.inputErr), (el) => el.child(div().px(2).text_size(10.5).text_color(down).child(this.inputErr)));

    // Columns sized to their longest entry, so the bars run right up to the numbers.
    const cells = this.list.map((m) => {
      const r = this.rows[m.id] ?? {};
      return { m, r, price: r.err || formatPrice(r.price, m.kind, m.sym), chg: r.err ? "" : formatChange(r.price, r.ref) + (r.daily ? " · daily" : "") };
    });
    const symW = Math.max(40, ...cells.map((c) => textW(c.m.sym, 12) + 4));
    const numW = Math.max(44, ...cells.map((c) => Math.max(textW(c.price, 12.5), textW(c.chg, 10.5)) + 4));
    const zoom = Number(settings()?.zoom) || 1;  // on_size_change reports physical px
    const sparkW = Math.max(16, (this.width ?? 408) / zoom - 24 - symW - numW - 16 - 12 - 10 - 8);

    const rows = cells.map(({ m, r, price, chg }) => {
      const rising = r.price != null && r.ref != null ? r.price >= r.ref : true;
      const flashing = r.flash && Date.now() - r.flashAt < FLASH_MS;
      const priceColor = flashing ? (r.flash === "up" ? up : down) : t.foreground;
      // While the dropdown is over the list, rows take no presses: a click on a suggestion
      // must not also open (or remove) the row underneath it.
      const live = !this.suggOpen;
      return h_flex().id(`row-${m.id}`).h(40).px(12).items_center()
        .when(live, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.openDetail(m)))
        .child(div().w(symW).mr(12).flex_shrink_0().truncate().text_size(12).font_semibold().text_color(t.foreground)
          .child(m.sym))
        .child(this.spark(r.spark, rising ? up : down, sparkW))
        .child(v_flex().w(numW).ml(10).mr(8).flex_shrink_0().items_end()
          .child(div().text_size(12.5).text_color(r.err ? t.dim : priceColor)
            .child(price))
          .child(div().text_size(10.5).text_color(rising ? up : down)
            .child(chg)))
        .child(h_flex().id(`x-${m.id}`).w(16).h(16).flex_shrink_0().rounded(4).items_center().justify_center()
          .text_size(12).text_color(t.dim)
          .when(live, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground).bg(t.raised))
            .on_click((_e, cx) => { cx.stop_propagation(); this.remove(m.id, cx); }))
          .child("×"));
    });

    return v_flex().id("market-data").size_full()
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } }).bg(t.chrome).text_color(t.foreground)
      .child(header)
      .child(field)
      .child(div().h(1).bg(t.border))
      .child(div().relative().flex_1().min_h(0).flex_col()
        .child(v_flex().id("market-rows").size_full().overflow_y_scrollbar().py(4).children(
          rows.length ? rows : [div().p(14).text_size(11.5).text_color(t.dim).child("Nothing watched yet.")]))
        .when(this.suggOpen, (el) => el.child(this.suggestions(t))))
      .when(this.infoHover || this.infoPinned, (el) => el.child(this.info(t)))
      .child(div().h(1).bg(t.border))
      .child(h_flex().px(12).py(5).items_center().justify_between()
        .child(div().text_size(10.5).text_color(t.dim).child("Prices are refreshed every 15s"))
        .child(h_flex().id("info").w(20).h(20).rounded(6).items_center().justify_center().cursor_pointer()
          .text_color(this.infoPinned ? t.foreground : t.muted)
          .when(this.infoPinned, (el) => el.bg(t.raised))
          .hover((s) => s.bg(t.raised).text_color(t.foreground))
          .on_hover((hovered, cx) => { this.infoHover = hovered; cx.notify(); })
          .on_click((_e, cx) => { this.infoPinned = !this.infoPinned; cx.notify(); })
          .child(svg("mods/market-data/info.svg").size(13))));
  }
}
