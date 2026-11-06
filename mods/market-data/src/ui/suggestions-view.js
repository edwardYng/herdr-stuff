// The add box's dropdown, laid over the top of the list.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("../state/search.js").Search} Search */

/**
 * @param {Search} search
 * @param {(id: string) => boolean} has whether a market is in the watchlist already ("✓ added")
 * @param {Theme} t
 */
export function suggestionsView(search, has, t) {
  const box = v_flex()
    .id("suggest")
    .absolute()
    .top(0)
    .left(10)
    .right(10)
    .py(4)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.popover)
    .shadow_lg();
  if (!search.sugg.length) {
    return box.child(div().px(10).py(6).text_size(11.5).text_color(t.dim).child(search.emptyMessage()));
  }
  return box.children(
    search.sugg.map((s, i) => {
      const on = i === search.sel;
      return h_flex()
        .id(`sg-${i}`)
        .mx(4)
        .px(8)
        .py(5)
        .gap(8)
        .rounded(6)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected ?? t.hover))
        .on_hover((h, cx) => {
          if (h) search.highlight(i, cx);
        })
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          search.choose(s.market, cx);
        })
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().text_size(12).font_semibold().text_color(t.foreground).child(s.market.sym))
                .child(div().px(4).rounded(3).bg(t.raised).text_size(9.5).text_color(t.muted).child(s.type)),
            )
            .child(div().text_size(10.5).text_color(t.muted).truncate().child(s.name)),
        )
        .child(
          div()
            .flex_shrink_0()
            .text_size(10.5)
            .text_color(t.dim)
            .child(has(s.market.id) ? "✓ added" : s.exchange),
        );
    }),
  );
}
