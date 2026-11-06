// Fake "gpui-kit" module for tests: elements record what was built (see ../element.js).
import { element } from "../element.js";

export class View {}
export const div = (...a) => element("div", a);
export const svg = (...a) => element("svg", a);
export const img = (...a) => element("img", a);
