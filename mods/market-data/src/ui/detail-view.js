// The details popup: a Yahoo Finance–style quote page for one market. Header, chart, the stat
// tables for that kind of quote, About, and a footer linking to Yahoo.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { DASH } from "../domain/format.js";
import { quoteHeader, quoteSections, visibleSections, quoteAbout, aboutText } from "../domain/quote.js";
import { quotePage } from "../state/detail.js";
import { chartView } from "./chart-view.js";
import { upDown } from "./theme.js";

/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("../state/detail.js").Detail} Detail */
/** @typedef {import("../domain/quote.js").Row} Row */
/** @typedef {{ width?: number }} DetailUi physical px, from on_size_change */

/** The popup's width before the first on_size_change (logical px). */
const DEFAULT_WIDTH = 640;
/** From this content width up, tables have two columns. */
const WIDE_PX = 460;

/**
 * @param {Detail} d
 * @param {Theme} t
 */
function headerView(d, t) {
  const { up, down } = upDown(t);
  const h = quoteHeader(d.q, d.m, { seed: d.seed, chartMeta: d.chartMeta() });
  const ext = h.ext
    ? h_flex()
        .id("ext-hours")
        .gap(8)
        .items_baseline()
        .child(
          div()
            .text_size(15)
            .font_semibold()
            .text_color(t.foreground)
            .child(h.ext.price ?? DASH),
        )
        .child(
          div()
            .text_size(12)
            .text_color(h.ext.up ? up : down)
            .child(h.ext.changeText),
        )
        .child(div().text_size(11).text_color(t.dim).child(h.ext.label))
    : null;

  return v_flex()
    .gap(4)
    .child(
      h_flex()
        .items_start()
        .justify_between()
        .gap(12)
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(div().text_size(17).font_semibold().text_color(t.foreground).child(h.name))
            .child(div().text_size(11.5).text_color(t.muted).child(h.sub)),
        )
        .child(
          h_flex()
            .id("close")
            .w(26)
            .h(26)
            .flex_shrink_0()
            .rounded(6)
            .items_center()
            .justify_center()
            .cursor_pointer()
            .text_size(16)
            .text_color(t.muted)
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_click(() => d.close())
            .child("×"),
        ),
    )
    .child(
      h_flex()
        .mt(8)
        .gap(10)
        .items_baseline()
        .child(
          div()
            .text_size(30)
            .font_semibold()
            .text_color(t.foreground)
            .child(h.price ?? DASH),
        )
        .when(h.change != null, (el) =>
          el.child(
            div()
              .text_size(15)
              .text_color(h.up ? up : down)
              .child(h.changeText),
          ),
        ),
    )
    .when(Boolean(ext), (el) => el.child(ext))
    .child(div().text_size(11).text_color(t.dim).child(h.status));
}

/**
 * Label/value rows, ruled like Yahoo's summary table; two columns when wide.
 * @param {Theme} t
 * @param {Row[]} rows
 * @param {boolean} wide
 */
function tableView(t, rows, wide) {
  /** @param {Row} row @param {number} i */
  const cell = ([label, value], i) =>
    h_flex()
      .id(`r-${label}-${i}`)
      .py(6)
      .gap(10)
      .justify_between()
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().text_size(11.5).text_color(t.muted).flex_shrink_0().child(label))
      .child(
        div()
          .text_size(12)
          .font_semibold()
          .text_color(t.foreground)
          .text_right()
          .min_w(0)
          .truncate()
          .child(value ?? DASH),
      );
  if (!wide) return v_flex().children(rows.map(cell));
  const half = Math.ceil(rows.length / 2);
  return h_flex()
    .gap(24)
    .items_start()
    .child(v_flex().flex_1().min_w(0).children(rows.slice(0, half).map(cell)))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .children(rows.slice(half).map((r, i) => cell(r, i + half))),
    );
}

/**
 * @param {Detail} d
 * @param {DetailUi} ui
 * @param {Theme} t
 * @param {number} zoom
 */
export function detailView(d, ui, t, zoom) {
  const inner = Math.max(200, (ui.width ?? DEFAULT_WIDTH * zoom) / zoom - 48);
  const wide = inner >= WIDE_PX;

  /** @param {string} text */
  const heading = (text) => div().mt(18).mb(4).text_size(12.5).font_semibold().text_color(t.foreground).child(text);
  const body = [headerView(d, t), div().h(16), chartView(d, t, inner)];

  const sections = visibleSections(quoteSections(d.q, d.m, { binance24h: d.bin, chartMeta: d.chartMeta() }));
  for (const s of sections) body.push(heading(s.title), tableView(t, s.rows, wide));
  if (!d.q && d.qErr) {
    body.push(
      div().mt(14).text_size(11).text_color(t.dim).child(`Full details unavailable (${d.qErr}). Showing the basics.`),
    );
  } else if (!d.q) {
    body.push(div().mt(18).text_size(11.5).text_color(t.dim).child("Loading details…"));
  }

  const a = quoteAbout(d.q);
  if (a.facts.length || a.text) {
    body.push(heading("About"));
    if (a.facts.length) body.push(tableView(t, a.facts, wide));
    if (a.text) {
      const { shown, long } = aboutText(a.text, d.more);
      body.push(div().mt(10).text_size(12).text_color(t.muted).whitespace_normal().child(shown));
      if (long) {
        body.push(
          div()
            .id("more")
            .mt(4)
            .text_size(11.5)
            .text_color(t.accent ?? t.foreground)
            .cursor_pointer()
            .hover((s) => s.underline())
            .on_click((_e, cx) => d.toggleMore(cx))
            .child(d.more ? "Show less" : "Show more"),
        );
      }
    }
    if (a.website) {
      const site = a.website;
      body.push(
        div()
          .id("site")
          .mt(8)
          .text_size(11.5)
          .text_color(t.accent ?? t.foreground)
          .cursor_pointer()
          .hover((s) => s.underline())
          .on_click((_e, cx) => cx.open_url(site))
          .child(site),
      );
    }
  }

  const footer = h_flex()
    .px(24)
    .py(9)
    .items_center()
    .justify_between()
    .border_t(1)
    .border_color(t.border)
    .child(
      div()
        .text_size(10.5)
        .text_color(t.dim)
        .child("Data: Yahoo Finance" + (d.m.kind === "crypto" ? " · Binance" : "")),
    )
    .child(
      h_flex()
        .id("yahoo")
        .px(8)
        .py(3)
        .rounded(5)
        .cursor_pointer()
        .text_size(11)
        .text_color(t.muted)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => cx.open_url(quotePage(d.ysym)))
        .child("Open in Yahoo Finance ↗"),
    );

  return v_flex()
    .id("market-detail")
    .size_full()
    .bg(t.popover ?? t.chrome)
    .text_color(t.foreground)
    .on_size_change((size, cx) => {
      if (size.width !== ui.width) {
        ui.width = size.width;
        cx.notify();
      }
    })
    .child(
      v_flex()
        .id("detail-scroll")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .child(v_flex().px(24).pt(18).pb(20).children(body)),
    )
    .child(footer);
}
