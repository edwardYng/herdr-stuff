// What the views read from Herdr each render: the theme's colors and the zoom.
import { theme, settings } from "herdr";

/** Herdr's theme colors by name (foreground, muted, dim, chrome, popover, raised, ansi1/2, ...). */
/** @typedef {Record<string, import("gpui-kit").Color>} Theme */

/** @returns {Theme} */
export function readTheme() {
  return /** @type {Theme} */ (theme());
}

/** The person's zoom: on_size_change reports physical px, layout lengths are logical. */
export function readZoom() {
  return Number(settings()?.zoom) || 1;
}

/** Rising and falling colors. @param {Theme} t */
export const upDown = (t) => ({ up: t.ansi2, down: t.ansi1 });

/**
 * A theme color at `alpha` (0..1), for gradients that fade out. #rgb, #rrggbb and #rrggbbaa in;
 * anything else comes back as it was.
 * @param {import("gpui-kit").Color} c
 * @param {number} alpha
 * @returns {import("gpui-kit").Color}
 */
export function withAlpha(c, alpha) {
  let hex = String(c).slice(1);
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return c;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return /** @type {import("gpui-kit").Color} */ (`#${hex.slice(0, 6)}${a}`);
}
