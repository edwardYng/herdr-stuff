// The popup's chart: range tabs and the change over the range, bars with round-number gridlines,
// the previous close dashed on a stock's 1D, a crosshair with a tooltip, and a price axis.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  RANGES,
  axisWidth,
  barCenterPct,
  barCount,
  bucket,
  hoverIndex,
  niceTicks,
  pointChange,
  rangeChange,
  yScale,
} from "../domain/chart.js";
import { formatChartTime, formatPrice, num } from "../domain/format.js";
import { upDown } from "./theme.js";

/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("../state/detail.js").Detail} Detail */
/** @typedef {import("gpui-kit").Color} Color */

export const CHART_H = 170;
const BAR_GAP = 1;
/** Hovering right of this (% of the plot), the tooltip goes on the line's left. */
const TIP_FLIP_PCT = 60;

/**
 * @param {Detail} d
 * @param {Theme} t
 * @param {number} width the content's width, px
 */
export function chartView(d, t, width) {
  const { up, down } = upDown(t);
  const c = d.chart();
  const range = d.range;
  const tabs = h_flex()
    .gap(2)
    .children(
      RANGES.map((r) => {
        const on = r.key === range;
        return div()
          .id(`rng-${r.key}`)
          .px(8)
          .py(3)
          .rounded(5)
          .cursor_pointer()
          .text_size(11.5)
          .font_semibold()
          .text_color(on ? (t.accent_foreground ?? t.foreground) : t.muted)
          .when(on, (el) => el.bg(t.accent ?? t.selected))
          .when(!on, (el) => el.hover((s) => s.bg(t.raised).text_color(t.foreground)))
          .on_click((_e, cx) => d.setRange(r.key, cx))
          .child(r.label);
      }),
    );

  /** @param {string} summary @param {Color} color */
  const head = (summary, color) =>
    h_flex().justify_between().items_center().child(tabs).child(div().text_size(11.5).text_color(color).child(summary));
  if (!c || c.closes.length < 2) {
    return v_flex()
      .gap(8)
      .child(head("", t.muted))
      .child(
        h_flex()
          .h(CHART_H)
          .items_center()
          .justify_center()
          .text_size(11.5)
          .text_color(t.dim)
          .child(d.chartErr || "Loading chart…"),
      );
  }

  const m = d.m;
  const vals = c.closes;
  const change = rangeChange(vals, c.meta, range, m.kind);
  const { base, last, stock1d } = change;
  const color = change.up ? up : down;
  /** @param {number} v */
  const fp = (v) => formatPrice(v, m.kind, m.sym);
  /** @param {number} s */
  const when = (s) => formatChartTime(s, range);

  // One bar per point, or per bucket when there are more points than fit. Bars fill the width, so
  // bar i spans [i/N, (i+1)/N] of the plot, which is what the pointer maps back to.
  const axisW = axisWidth([fp(last), fp(Math.max(...vals))]);
  const plotW = Math.max(60, width - axisW);
  const { idx, pts } = bucket(vals, barCount(plotW));
  const N = idx.length;
  const { lo, hi, y } = yScale(pts, CHART_H, stock1d ? base : null);
  const { ticks, decimals } = niceTicks(lo, hi, 5);

  const hov = d.hover != null && d.hover < N ? d.hover : null;
  const hv = hov != null ? pts[hov] : null;

  const layers = [];
  for (const v of ticks) layers.push(div().absolute().left(0).right(0).top(y(v)).h(1).bg(t.border).opacity(0.6));
  layers.push(
    h_flex()
      .absolute()
      .inset_0()
      .items_end()
      .gap(BAR_GAP)
      .children(
        pts.map((v, i) =>
          div()
            .id(`b${i}`)
            .flex_1()
            .min_w(1)
            .h(Math.max(2, CHART_H - y(v)))
            .rounded(1)
            .bg(color)
            .opacity(hov == null ? 0.8 : i === hov ? 1 : 0.45),
        ),
      ),
  );
  // Previous close, dashed (drawn as dashes: a 0-height dashed border doesn't paint).
  if (stock1d) {
    layers.push(
      h_flex()
        .id("prev-close")
        .absolute()
        .left(0)
        .right(0)
        .top(y(base))
        .h(1)
        .gap(3)
        .overflow_hidden()
        .children(
          Array.from({ length: Math.ceil(plotW / 7) }, () =>
            div().w(4).h(1).flex_shrink_0().bg(t.foreground).opacity(0.55),
          ),
        ),
    );
  }
  if (hov != null) {
    const x = barCenterPct(hov, N);
    layers.push(div().id("crosshair-x").absolute().top(0).bottom(0).left(`${x}%`).w(1).bg(t.foreground).opacity(0.7));
    layers.push(div().id("crosshair-y").absolute().left(0).right(0).top(y(hv)).h(1).bg(t.foreground).opacity(0.35));
    const tip = v_flex()
      .id("tooltip")
      .px(8)
      .py(5)
      .gap(1)
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg(t.raised ?? t.popover)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(fp(hv)))
      .child(
        div()
          .text_size(11)
          .text_color(hv >= base ? up : down)
          .child(pointChange(hv, base)),
      )
      .child(div().text_size(10.5).text_color(t.muted).child(when(c.times[idx[hov]])));
    // Beside the line, on whichever side has room.
    layers.push(
      x < TIP_FLIP_PCT
        ? div().absolute().top(2).left(`${x}%`).child(tip.ml(8))
        : div()
            .absolute()
            .top(2)
            .right(`${100 - x}%`)
            .child(tip.mr(8)),
    );
  }

  const plot = div()
    .id("plot")
    .relative()
    .flex_1()
    .min_w(0)
    .h(CHART_H)
    .on_mouse_move((e, cx) => {
      const i = hoverIndex(e.local_position.x, e.bounds?.width, N);
      if (i != null) d.setHover(i, cx);
    })
    .on_hover((h, cx) => {
      if (!h) d.setHover(null, cx);
    })
    .children(layers);

  // Price axis: round-number ticks, plus a pill for the last price (or the hovered one), like Yahoo.
  /** @param {number} v @param {Color} bg @param {Color} fg */
  const pill = (v, bg, fg) =>
    div()
      .id("axis-pill")
      .absolute()
      .left(4)
      .top(y(v) - 9)
      .px(5)
      .py(1)
      .rounded(4)
      .bg(bg)
      .text_size(10.5)
      .font_semibold()
      .text_color(fg)
      .whitespace_nowrap()
      .child(fp(v));
  const axis = div()
    .id("axis")
    .relative()
    .w(axisW)
    .h(CHART_H)
    .flex_shrink_0()
    .children(
      ticks.map((v) =>
        div()
          .absolute()
          .left(8)
          .top(y(v) - 7)
          .text_size(10.5)
          .text_color(t.dim)
          .whitespace_nowrap()
          .child(num(v, decimals)),
      ),
    )
    .child(hov != null ? pill(hv, t.foreground, t.background) : pill(last, color, t.background));

  const labels = h_flex()
    .mr(axisW)
    .justify_between()
    .text_size(10.5)
    .text_color(t.dim)
    .child(div().child(when(c.times[0])))
    .child(
      div().child(
        `Low ${fp(Math.min(...vals))} · High ${fp(Math.max(...vals))}` +
          (stock1d ? ` · Prev close ${fp(base)} (dashed)` : ""),
      ),
    )
    .child(div().child(when(c.times.at(-1))));

  return v_flex()
    .gap(8)
    .child(head(change.summary, color))
    .child(h_flex().items_start().child(plot).child(axis))
    .child(labels);
}
