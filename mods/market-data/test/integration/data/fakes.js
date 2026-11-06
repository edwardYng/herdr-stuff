// Fakes for the data clients: a fetch and a curl-through-exec that answer from recorded fixtures,
// and an in-memory localStorage. Each records what it was asked.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** A fixture's text. @param {string} path relative to test/fixtures */
export const fixtureText = (path) => readFileSync(FIXTURES + path, "utf8");
/** A fixture, parsed. @param {string} path relative to test/fixtures */
export const fixture = (path) => JSON.parse(fixtureText(path));

/**
 * @typedef {{ status?: number, fixture?: string, json?: any, body?: string, error?: Error }} Answer
 * @typedef {[RegExp | string | ((url: string) => boolean), Answer | ((url: string) => Answer)]} Route
 */

/** @param {Route[0]} m @param {string} url */
const matches = (m, url) => (typeof m === "function" ? m(url) : typeof m === "string" ? url.includes(m) : m.test(url));

/** @param {Route[]} routes @param {string} url */
function answer(routes, url) {
  const route = routes.find(([m]) => matches(m, url));
  if (!route) throw new Error(`fake: no route for ${url}`);
  return typeof route[1] === "function" ? route[1](url) : route[1];
}

/** @param {Answer} a */
const bodyOf = (a) =>
  a.body ?? (a.fixture ? fixtureText(a.fixture) : a.json !== undefined ? JSON.stringify(a.json) : "");

/**
 * A fetch that answers by URL: the first matching route wins; no match is a test bug and throws.
 * `calls` keeps [url, options] for each request.
 * @param {Route[]} routes
 */
export function fakeFetch(routes) {
  /** @type {{ url: string, options: any }[]} */
  const calls = [];
  /** @param {string} url @param {any} [options] */
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const a = answer(routes, url);
    if (a.error) throw a.error;
    const status = a.status ?? 200;
    const text = bodyOf(a);
    return {
      status,
      ok: status >= 200 && status < 300,
      url,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return Object.assign(fetch, { calls });
}

/**
 * An exec that behaves like curl run with `-w "\n%{http_code}"`: stdout is the body (with the
 * header block first when -i is given and the route has `headers`) then "\n<status>".
 * Routes match the URL (curl's last argument). `calls` keeps [command, args].
 * @param {[Route[0], (Answer & { headers?: string, stdout?: string }) | ((url: string) => Answer & { headers?: string, stdout?: string })][]} routes
 */
export function fakeCurl(routes) {
  /** @type {{ command: string, args: string[] }[]} */
  const calls = [];
  /** @param {string} command @param {string[]} [args] */
  const exec = async (command, args = []) => {
    calls.push({ command, args });
    const url = args.at(-1);
    const a = /** @type {any} */ (answer(routes, url));
    if (a.error) throw a.error;
    if (a.stdout != null) return { code: 0, stdout: a.stdout, stderr: "" };
    const head = args.includes("-i") && a.headers ? a.headers : "";
    return { code: 0, stdout: `${head}${bodyOf(a)}\n${a.status ?? 200}`, stderr: "" };
  };
  return Object.assign(exec, { calls });
}

/** Header block curl -i prints for fc.yahoo.com, with the given A3 cookie (CRLF like real HTTP). */
export const fcHeaders = (a3 = "d=AQABBFAKE&S=AQAAAFAKE") =>
  [
    "HTTP/2 404 ",
    "content-type: text/html",
    `set-cookie: A3=${a3}; Expires=Sat, 6 Nov 2027 08:09:51 GMT; Max-Age=31557600; Domain=.yahoo.com; Path=/; SameSite=None; Secure; HttpOnly`,
    "content-length: 4580",
    "",
    "",
  ].join("\r\n");

/** An in-memory localStorage that counts reads. */
export function memoryStorage(initial = /** @type {Record<string, string>} */ ({})) {
  const data = new Map(Object.entries(initial));
  const storage = {
    reads: 0,
    /** @param {string} k */
    getItem(k) {
      storage.reads++;
      return data.has(k) ? data.get(k) : null;
    },
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      data.set(k, String(v));
    },
    data,
  };
  return storage;
}
