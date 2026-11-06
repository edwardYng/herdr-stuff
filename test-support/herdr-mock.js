// State behind the fake "herdr" module (stubs/herdr.js). Tests set what Herdr would answer and
// read what the code asked of it. Call herdrMock.reset() in beforeEach.

const THEME_KEYS = [
  "foreground",
  "muted",
  "dim",
  "background",
  "chrome",
  "popover",
  "raised",
  "hover",
  "selected",
  "border",
  "input",
  "accent",
  "accent_foreground",
  "ansi1",
  "ansi2",
];

export const herdrMock = {
  /** @type {Record<string, any>} */ props: {},
  /** @type {Record<string, any>} */ settings: {},
  /** @type {Record<string, string>} */ theme: {},
  /** @type {any[]} */ overlays: [],
  /** @type {string[]} */ closed: [],
  /** @type {any[]} */ notifications: [],
  /** @type {(cmd: string, args: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} */
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  reset() {
    this.props = {};
    this.settings = { zoom: 1 };
    this.theme = Object.fromEntries(THEME_KEYS.map((k) => [k, `#${k}`]));
    this.overlays = [];
    this.closed = [];
    this.notifications = [];
    this.exec = async () => ({ code: 0, stdout: "", stderr: "" });
  },
};
herdrMock.reset();
