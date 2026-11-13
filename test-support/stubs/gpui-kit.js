// Fake "gpui-kit" module for tests: elements record what was built (see ../element.js).
import { element } from "../element.js";

export class View {}
export const div = (...a) => element("div", a);
export const svg = (...a) => element("svg", a);
export const img = (...a) => element("img", a);

// Paths record their points; the painted element records the path and its background.
const pathBuilder = (kind, width) => {
  const p = { kind, width, polygons: [], dash: null };
  const b = {
    add_polygon: (points, closed = false) => (p.polygons.push({ points, closed }), b),
    dash_array: (values) => ((p.dash = values), b),
    build: () => p,
  };
  return b;
};
export const PathBuilder = { fill: () => pathBuilder("fill"), stroke: (w) => pathBuilder("stroke", w) };

const background = (spec) => ({ ...spec, opacity: (f) => background({ ...spec, opacity: f }) });
export const Background = {
  solid: (color) => background({ solid: color }),
  stop: (color, pct) => ({ color, pct }),
  linear_gradient: (angle, from, to) => background({ angle, from, to }),
};

// `window` is a global in Herdr; give Node one that can paint.
globalThis.window ??= /** @type {any} */ ({});
globalThis.window.paint_path ??= (path, bg) => element("path", [path, bg]);
