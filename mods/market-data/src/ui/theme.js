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
