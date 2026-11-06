// A recording stand-in for gpui-kit elements, so views can be rendered in Node.
// Every builder method returns the same element (like the real fluent API). A few are understood:
// child/children (the tree), id, when, and the on_* handlers (so tests can fire them).

const HANDLERS = new Set([
  "on_click",
  "on_hover",
  "on_mouse_move",
  "on_key_down",
  "on_key_up",
  "on_size_change",
  "on_mouse_down_out",
  "on_scroll_wheel",
]);

/**
 * @typedef {{ tag: string, args: unknown[], elId: unknown, kids: unknown[],
 *   handlers: Record<string, Function>, calls: [string, unknown[]][] }} FakeElement
 */

/** @param {string} tag @param {unknown[]} args @returns {any} */
export function element(tag, args = []) {
  /** @type {FakeElement} */
  const node = { tag, args, elId: undefined, kids: [], handlers: {}, calls: [] };
  const proxy = new Proxy(node, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return (...a) => {
        target.calls.push([prop, a]);
        if (prop === "child") target.kids.push(a[0]);
        else if (prop === "children") target.kids.push(...a[0]);
        else if (prop === "id") target.elId = a[0];
        else if (prop === "when") return a[0] ? (a[1](proxy) ?? proxy) : proxy;
        else if (prop === "on_mouse_down" || prop === "on_mouse_up") target.handlers[`${prop}:${a[0]}`] = a[1];
        else if (HANDLERS.has(prop)) target.handlers[prop] = a[0];
        return proxy;
      };
    },
  });
  return proxy;
}

/** @returns {x is FakeElement} */
export const isElement = (x) => x != null && typeof x === "object" && Array.isArray(x.kids) && "handlers" in x;

/** All text in a rendered tree, in order, joined by " | ". */
export function textOf(el) {
  const out = [];
  const walk = (n) => {
    if (n == null || n === false) return;
    if (typeof n === "string" || typeof n === "number") return void out.push(String(n));
    if (isElement(n)) n.kids.forEach(walk);
  };
  walk(el);
  return out.join(" | ");
}

/** Every element in the tree that matches. */
export function findAll(el, pred) {
  const out = [];
  const walk = (n) => {
    if (!isElement(n)) return;
    if (pred(n)) out.push(n);
    n.kids.forEach(walk);
  };
  walk(el);
  return out;
}

/** The element with this id. Throws if absent, so a test fails at the right line. */
export function byId(el, id) {
  const hit = findAll(el, (n) => n.elId === id)[0];
  if (!hit) throw new Error(`no element with id ${JSON.stringify(id)}`);
  return hit;
}

/** Whether a builder method was called on the element (e.g. "absolute"), optionally with these args. */
export const called = (el, method, ...args) =>
  el.calls.some(([m, a]) => m === method && args.every((x, i) => Object.is(a[i], x)));
