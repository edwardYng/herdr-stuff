// A row's sparkline: a thin line across the row's spare width, newest on the right.
import { div, PathBuilder, Background } from "gpui-kit";
import { bucket, pointCount, pointPct } from "../domain/chart.js";
import { withAlpha } from "./theme.js";

/** @typedef {import("gpui-kit").Color} Color */

export const SPARK_H = 20;
const LINE_W = 1.25;
/** Kept clear above and below so the stroke isn't clipped at the extremes. */
const PAD = 2;

/**
 * Spans the width it's given, oldest value at the left edge, newest at the right. Downsampled to
 * about one point per 2 px. Empty below two points.
 * @param {number[] | undefined} values
 * @param {Color} color
 * @param {number} width px available
 */
export function sparkView(values, color, width) {
  const box = div().id("spark").relative().flex_1().min_w(0).overflow_hidden().h(SPARK_H);
  if (!values || values.length < 2) return box;
  const { pts } = bucket(values, pointCount(width));
  const n = pts.length;
  const lo = Math.min(...pts),
    hi = Math.max(...pts),
    span = hi - lo || 1;
  // A flat series draws through the middle rather than along the bottom.
  /** @param {number} v */
  const y = (v) => (hi === lo ? SPARK_H / 2 : PAD + (1 - (v - lo) / span) * (SPARK_H - 2 * PAD));
  /** @type {[`${number}%`, number][]} */
  const line = pts.map((v, i) => [`${pointPct(i, n)}%`, y(v)]);
  const area = PathBuilder.fill()
    .add_polygon([...line, ["100%", SPARK_H], ["0%", SPARK_H]], true)
    .build();
  const stroke = PathBuilder.stroke(LINE_W).add_polygon(line, false).build();
  const fade = Background.linear_gradient(
    180,
    Background.stop(withAlpha(color, 0.22), 0),
    Background.stop(withAlpha(color, 0), 100),
  );
  return box
    .child(div().id("spark-area").absolute().inset_0().child(window.paint_path(area, fade).size_full()))
    .child(div().id("spark-line").absolute().inset_0().child(window.paint_path(stroke, color).size_full()));
}
