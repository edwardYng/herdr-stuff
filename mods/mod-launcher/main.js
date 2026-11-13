// Open a mod. A palette (like Cmd+Shift+P) listing every mod in
// ~/.config/herdr-app/mods: your own first, then Herdr's panels. Type to
// filter, ↑/↓ to choose; Enter opens it in a pane to the right of the focused
// one, Shift+Enter (or Shift+click) in a new tab. Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { appHome, closeOverlay, focused, props, readTextFile, run, theme } from "herdr";
import { exists, readdir } from "fs/promises";

const SELF = "mod-launcher";

// Shipped mods that are window chrome (menus, dialogs, toasts, bars), not
// something to open as a pane on its own.
const CHROME = new Set([
  "confirm",
  "help",
  "machine-add",
  "menu",
  "new-menu",
  "pane",
  "peek",
  "picker",
  "prompt",
  "terminals-bar",
  "terminals-pane",
  "toast",
  "win98",
  "workspace-chrome",
  "workspace-status",
  "worktree",
]);

/**
 * @typedef {{ name: string, title: string, about: string, mine: boolean }} ModEntry
 * @typedef {Record<string, import("gpui-kit").Color>} Theme
 */

/** First line of the mod's leading `//` comment, as a one-line description. */
function aboutOf(src) {
  if (!src) return "";
  const lines = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*\/\/\s?(.*)$/);
    if (!m) break;
    lines.push(m[1].trim());
  }
  const text = lines.join(" ").trim();
  const first = text.match(/^.*?[.!?](\s|$)/);
  return (first ? first[0] : text).trim();
}

/** @returns {Promise<ModEntry[]>} */
async function loadMods() {
  const home = appHome();
  const dir = `${home}/mods`;
  /** @type {Record<string, unknown>} */
  let shipped = {};
  try {
    shipped = JSON.parse((await readTextFile(`${home}/installed.json`)) ?? "{}");
  } catch {
    // No installed.json: treat every mod as the person's own.
  }
  const names = (await readdir(dir)).filter((n) => !n.startsWith(".") && n !== SELF);
  /** @type {ModEntry[]} */
  const out = [];
  for (const name of names) {
    // Symlinked mods aren't directories to readdir, so test for main.js instead.
    if (!(await exists(`${dir}/${name}/main.js`))) continue;
    const mine = !(name in shipped);
    if (!mine && CHROME.has(name)) continue;
    let title = name;
    try {
      const meta = JSON.parse((await readTextFile(`${dir}/${name}/mod.json`)) ?? "{}");
      if (typeof meta.title === "string" && meta.title) title = meta.title;
    } catch {
      // No or invalid mod.json: keep the folder name.
    }
    let about = "";
    try {
      about = aboutOf(await readTextFile(`${dir}/${name}/main.js`));
    } catch {
      // Unreadable main.js: no description.
    }
    out.push({ name, title, about, mine });
  }
  out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.title.localeCompare(b.title));
  return out;
}

export default class ModLauncher extends View {
  init(_props, cx) {
    /** @type {ModEntry[] | null} */
    this.mods = null;
    this.error = "";
    this.filter = "";
    this.at = 0;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Open a mod…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      this.scroll.scroll_to_item(0);
      cx.notify();
    });
    this.input.on("submit", (e) => this.open(this.visible()[this.at], !!e?.shift));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async (cx) => {
      try {
        this.mods = await loadMods();
      } catch (e) {
        this.mods = [];
        this.error = `Couldn't read the mods folder: ${e instanceof Error ? e.message : String(e)}`;
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  /** @returns {ModEntry[]} */
  visible() {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (this.mods ?? []).filter((m) => {
      const hay = `${m.title} ${m.name} ${m.about}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  /** Splits the focused pane to the right with the mod, or opens it in a new tab
   *  (also when no pane has focus, since there's nothing to split). */
  open(m, newTab) {
    if (!m) return;
    this.close();
    if (newTab || !focused()?.pane) run("tab.new", { mod: m.name, name: m.title });
    else run("pane.split", { direction: "right", mod: m.name });
  }

  render() {
    const t = /** @type {Theme} */ (theme());
    const root = v_flex()
      .id("mod-launcher")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13);
    return this.renderList(t, root);
  }

  header(t, title) {
    return h_flex()
      .items_center()
      .gap(8)
      .child(div().flex_1().truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .child(
        div()
          .id("ml-esc")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.close())
          .child("Esc"),
      );
  }

  renderList(t, root) {
    const rows = this.visible();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const firstBuiltIn = rows.findIndex((m) => !m.mine);
    const anyMine = rows.some((m) => m.mine);

    /** @type {any[]} */
    const items = [];
    rows.forEach((m, i) => {
      if (i === 0 && anyMine) items.push(this.sectionHead(t, "Your mods", "ml-h-mine"));
      if (i === firstBuiltIn) items.push(this.sectionHead(t, "Built in", "ml-h-builtin"));
      const on = i === this.at;
      items.push(
        h_flex()
          .id(`ml-${m.name}`)
          .mx(4)
          .px(10)
          .h(40)
          .flex_none()
          .rounded(7)
          .gap(10)
          .items_center()
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover))
          .on_click((e) => this.open(m, !!e?.modifiers?.shift))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .child(div().truncate().text_color(t.foreground).child(m.title))
              .when(!!m.about, (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(m.about))),
          )
          .when(m.title.toLowerCase() !== m.name.toLowerCase(), (el) =>
            el.child(div().text_size(11).text_color(t.dim).child(m.name)),
          ),
      );
    });

    let empty = null;
    if (this.error) empty = this.error;
    else if (this.mods === null) empty = "Loading mods…";
    else if (!rows.length) empty = this.filter ? `No mod matches “${this.filter}”` : "No mods found";

    return root
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (!rows.length) return;
        if (k === "down") this.at = (this.at + 1) % rows.length;
        else if (k === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        this.scroll.scroll_to_item(this.itemIndex(rows, this.at));
        cx.stop_propagation();
        cx.notify();
      })
      .child(this.header(t, "Open a mod"))
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        empty
          ? div().px(10).py(12).text_color(t.dim).child(empty)
          : v_flex()
              .id("ml-list")
              // A scroll area in a flex column needs a definite height, or it collapses to 0.
              .h(Math.min(360, rows.length * 40 + (items.length - rows.length) * 26 + 4))
              .flex_none()
              .pb(4)
              .overflow_y_scrollbar()
              .track_scroll(this.scroll)
              .children(items),
      )
      .child(this.footer(t, "↑↓ choose · Enter open to the right · ⇧Enter new tab · Esc close"));
  }

  /** Index of row `at` among the list's children, counting section heads. */
  itemIndex(rows, at) {
    const firstBuiltIn = rows.findIndex((m) => !m.mine);
    let i = at;
    if (rows.some((m) => m.mine)) i += 1;
    if (firstBuiltIn >= 0 && at >= firstBuiltIn) i += 1;
    return i;
  }

  sectionHead(t, label, id) {
    return div().id(id).h(26).px(14).pt(8).flex_none().text_size(11).font_semibold().text_color(t.dim).child(label);
  }

  footer(t, text) {
    return div().px(4).text_size(11).text_color(t.dim).child(text);
  }
}
