// A row's sparkline: thin bars, newest on the right.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { barCount, bucket } from "../domain/chart.js";

/** @typedef {import("gpui-kit").Color} Color */

export const BAR_W = 3;
export const BAR_GAP = 1;
export const SPARK_H = 20;

/**
 * Bars are always BAR_W wide: a wider tile shows more of them, never fatter ones. Downsampled when
 * there are more points than bars. Empty below two points.
 * @param {number[] | undefined} values
 * @param {Color} color
 * @param {number} width px available
 */
export function sparkView(values, color, width) {
  const box = h_flex().flex_1().min_w(0).overflow_hidden().h(SPARK_H).items_end().justify_end().gap(BAR_GAP);
  if (!values || values.length < 2) return box;
  const { pts } = bucket(values, barCount(width, { barW: BAR_W, gap: BAR_GAP, min: 4 }));
  const lo = Math.min(...pts),
    hi = Math.max(...pts),
    span = hi - lo || 1;
  return box.children(
    pts.map((v, i) =>
      div()
        .id(`s${i}`)
        .w(BAR_W)
        .flex_shrink_0()
        .h(2 + ((v - lo) / span) * 18)
        .rounded(1)
        .bg(color)
        .opacity(0.75),
    ),
  );
}
