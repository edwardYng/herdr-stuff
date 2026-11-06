// The tile: header with ↻, the add box (and its dropdown), the rows, the ⓘ panel and the footer.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { openOverlay } from "herdr";
import { formatPrice, formatChange, textWidth } from "../domain/format.js";
import { sparkView } from "./spark.js";
import { infoPanel } from "./info-panel.js";
import { suggestionsView } from "./suggestions-view.js";
import { upDown } from "./theme.js";

/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("../domain/markets.js").Market} Market */
/** @typedef {import("../state/watchlist.js").Watchlist} Watchlist */
/** @typedef {import("../state/watchlist.js").Row} Row */
/** @typedef {import("../state/search.js").Search} Search */
/**
 * The tile's own view state: its width (physical px, from on_size_change) and the ⓘ panel.
 * @typedef {{ width?: number, infoHover?: boolean, infoPinned?: boolean }} TileUi
 */

const REFRESH_ICON = "mods/market-data/refresh.svg";
const INFO_ICON = "mods/market-data/info.svg";
/** The width assumed before the first on_size_change. */
const DEFAULT_WIDTH = 408;

/**
 * Clicking a row: a Yahoo Finance–style popup for that market (this mod again, as a dialog). FX has
 * the shortest page on Yahoo too: a shorter dialog.
 * @param {Market} m
 * @param {Row | undefined} row
 * @returns {string} the overlay's id
 */
export function openDetail(m, row) {
  const r = row ?? {};
  return openOverlay({
    mod: "market-data",
    kind: "dialog",
    width: 680,
    height: m.kind === "fx" ? 0.62 : 0.88,
    props: { market: m, price: r.price ?? null, ref: r.ref ?? null },
  });
}

/**
 * @param {{ watchlist: Watchlist, search: Search, ui: TileUi, zoom: number }} s
 * @param {Theme} t
 */
export function tileView({ watchlist, search, ui, zoom }, t) {
  const { up, down } = upDown(t);
  const icon = svg(REFRESH_ICON).size(13);
  const header = h_flex()
    .h(34)
    .px(12)
    .items_center()
    .justify_between()
    .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Markets"))
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(
          div()
            .text_size(10.5)
            .text_color(t.dim)
            .child(watchlist.keys === null ? "no Alpaca keys" : ""),
        )
        .child(
          h_flex()
            .id("refresh")
            .w(22)
            .h(22)
            .rounded(6)
            .items_center()
            .justify_center()
            .cursor_pointer()
            .text_color(watchlist.busy ? t.foreground : t.muted)
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_click((_e, cx) => watchlist.refreshNow(cx))
            .child(watchlist.busy ? icon.spin(900) : icon),
        ),
    );

  const field = v_flex()
    .id("add-field")
    .px(10)
    .pb(8)
    .gap(4)
    .on_key_down((e, cx) => search.key(e, cx))
    .child(
      Input.new(search.input)
        .h(30)
        .px(9)
        .rounded(7)
        .border_1()
        .border_color(search.err ? down : t.input)
        .bg(t.background)
        .text_size(12)
        .text_color(t.foreground),
    )
    .when(Boolean(search.err), (el) => el.child(div().px(2).text_size(10.5).text_color(down).child(search.err)));

  // Columns sized to their longest entry, so the bars run right up to the numbers.
  const cells = watchlist.list.map((m) => {
    const r = watchlist.rows[m.id] ?? {};
    return {
      m,
      r,
      price: r.err || formatPrice(r.price, m.kind, m.sym),
      chg: r.err ? "" : formatChange(r.price, r.ref) + (r.daily ? " · daily" : ""),
    };
  });
  const symW = Math.max(40, ...cells.map((c) => textWidth(c.m.sym, 12) + 4));
  const numW = Math.max(44, ...cells.map((c) => Math.max(textWidth(c.price, 12.5), textWidth(c.chg, 10.5)) + 4));
  const sparkW = Math.max(16, (ui.width ?? DEFAULT_WIDTH) / zoom - 24 - symW - numW - 16 - 12 - 10 - 8);

  // While the dropdown is over the list, rows take no presses: a click on a suggestion must not
  // also open (or remove) the row underneath it.
  const live = !search.open;
  const rows = cells.map(({ m, r, price, chg }) => {
    const rising = r.price != null && r.ref != null ? r.price >= r.ref : true;
    const flash = watchlist.flashOf(r);
    const priceColor = flash ? (flash === "up" ? up : down) : t.foreground;
    return h_flex()
      .id(`row-${m.id}`)
      .h(40)
      .px(12)
      .items_center()
      .when(live, (el) =>
        el
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => openDetail(m, watchlist.rows[m.id])),
      )
      .child(
        div()
          .w(symW)
          .mr(12)
          .flex_shrink_0()
          .truncate()
          .text_size(12)
          .font_semibold()
          .text_color(t.foreground)
          .child(m.sym),
      )
      .child(sparkView(r.spark, rising ? up : down, sparkW))
      .child(
        v_flex()
          .w(numW)
          .ml(10)
          .mr(8)
          .flex_shrink_0()
          .items_end()
          .child(
            div()
              .text_size(12.5)
              .text_color(r.err ? t.dim : priceColor)
              .child(price),
          )
          .child(
            div()
              .text_size(10.5)
              .text_color(rising ? up : down)
              .child(chg),
          ),
      )
      .child(
        h_flex()
          .id(`x-${m.id}`)
          .w(16)
          .h(16)
          .flex_shrink_0()
          .rounded(4)
          .items_center()
          .justify_center()
          .text_size(12)
          .text_color(t.dim)
          .when(live, (el) =>
            el
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground).bg(t.raised))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                watchlist.remove(m.id, cx);
              }),
          )
          .child("×"),
      );
  });

  return v_flex()
    .id("market-data")
    .size_full()
    .on_size_change((size, cx) => {
      if (size.width !== ui.width) {
        ui.width = size.width;
        cx.notify();
      }
    })
    .bg(t.chrome)
    .text_color(t.foreground)
    .child(header)
    .child(field)
    .child(div().h(1).bg(t.border))
    .child(
      div()
        .relative()
        .flex_1()
        .min_h(0)
        .flex_col()
        .child(
          v_flex()
            .id("market-rows")
            .size_full()
            .overflow_y_scrollbar()
            .py(4)
            .children(
              rows.length ? rows : [div().p(14).text_size(11.5).text_color(t.dim).child("Nothing watched yet.")],
            ),
        )
        .when(search.open, (el) => el.child(suggestionsView(search, (id) => watchlist.has(id), t))),
    )
    .when(ui.infoHover || ui.infoPinned, (el) => el.child(infoPanel(t)))
    .child(div().h(1).bg(t.border))
    .child(
      h_flex()
        .px(12)
        .py(5)
        .items_center()
        .justify_between()
        .child(div().text_size(10.5).text_color(t.dim).child("Prices are refreshed every 15s"))
        .child(
          h_flex()
            .id("info")
            .w(20)
            .h(20)
            .rounded(6)
            .items_center()
            .justify_center()
            .cursor_pointer()
            .text_color(ui.infoPinned ? t.foreground : t.muted)
            .when(ui.infoPinned, (el) => el.bg(t.raised))
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_hover((hovered, cx) => {
              ui.infoHover = hovered;
              cx.notify();
            })
            .on_click((_e, cx) => {
              ui.infoPinned = !ui.infoPinned;
              cx.notify();
            })
            .child(svg(INFO_ICON).size(13)),
        ),
    );
}
