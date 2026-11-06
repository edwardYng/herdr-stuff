// Yahoo's A3 cookie + "crumb", which quoteSummary needs. Herdr's fetch can't read Set-Cookie, so
// these requests go through curl (exec). The cookie lasts about a year and the crumb goes with it:
// keep them (in storage, under "yahoo") until Yahoo says no.
import { UA } from "./http.js";

/** @typedef {(command: string, args?: string[]) => Promise<{ stdout: string }>} ExecFn */
/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} StorageLike */
/** @typedef {{ cookie: string, crumb: string }} YahooCredentials */
/** @typedef {{ status: number, body: string }} CurlResponse */

const Q1 = "https://query1.finance.yahoo.com";
const KEY = "yahoo";

/**
 * @param {{ exec: ExecFn, platform: string, storage?: StorageLike | null }} deps
 */
export function createYahooSession({ exec, platform, storage }) {
  const bin = platform === "win32" || platform === "windows" ? "curl.exe" : "curl";
  /** @type {YahooCredentials | null} */
  let creds = null;
  let loaded = false;
  /** @type {Promise<YahooCredentials> | null} */
  let creating = null;

  /**
   * curl's stdout is the body (headers first with -i) then "\n<status>" from -w.
   * @param {string} url
   * @param {string | null} cookie
   * @param {boolean} [withHeaders]
   * @returns {Promise<CurlResponse>} status 0 when curl got no answer.
   */
  async function curl(url, cookie, withHeaders = false) {
    const args = ["-s", "--compressed", "--max-time", "12", "-A", UA, "-w", "\n%{http_code}"];
    if (withHeaders) args.push("-i");
    if (cookie) args.push("-H", `Cookie: ${cookie}`);
    args.push(url);
    const r = await exec(bin, args);
    const out = r?.stdout ?? "";
    const i = out.lastIndexOf("\n");
    return { status: Number(out.slice(i + 1)) || 0, body: i < 0 ? "" : out.slice(0, i) };
  }

  /** @returns {YahooCredentials | null} */
  function stored() {
    if (!loaded) {
      loaded = true;
      try {
        const s = JSON.parse(storage?.getItem(KEY) ?? "null");
        if (s && typeof s.cookie === "string" && typeof s.crumb === "string") creds = s;
      } catch {
        // unreadable: start a new session
      }
    }
    return creds;
  }

  /** @returns {Promise<YahooCredentials>} */
  async function create() {
    // fc.yahoo.com answers 404, but sets the A3 cookie on the way.
    const r = await curl("https://fc.yahoo.com", null, true);
    const cookie = r.body.match(/^set-cookie:\s*(A3=[^;\r\n]+)/im)?.[1];
    if (!cookie) throw new Error("no Yahoo cookie");
    const c = await curl(`${Q1}/v1/test/getcrumb`, cookie);
    const crumb = c.body.trim();
    if (c.status !== 200 || !crumb || crumb.includes("<") || crumb.includes("{")) throw new Error("no Yahoo crumb");
    creds = { cookie, crumb };
    loaded = true;
    try {
      storage?.setItem(KEY, JSON.stringify(creds));
    } catch {
      // not persisted: fine, it's only a cache
    }
    return creds;
  }

  /** One new session at a time, however many requests want it. */
  function fresh() {
    creating ??= create().finally(() => {
      creating = null;
    });
    return creating;
  }

  return {
    /**
     * GETs `url` with the cookie and the crumb appended. On 401/403 it starts a new session and
     * tries once more.
     * @param {string} url
     * @returns {Promise<CurlResponse>} whatever the last attempt answered (status 0: no answer).
     * @throws Error("no Yahoo cookie" | "no Yahoo crumb") when a session can't be started, or exec's
     *   error when curl can't run.
     */
    async get(url) {
      /** @type {CurlResponse} */
      let r = { status: 0, body: "" };
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = (attempt === 0 && stored()) || (await fresh());
        const sep = url.includes("?") ? "&" : "?";
        r = await curl(`${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, s.cookie);
        if (r.status !== 401 && r.status !== 403) return r;
        creds = null;
      }
      return r;
    },

    /** The credentials in use, if any (loads the stored ones). @returns {YahooCredentials | null} */
    current() {
      return stored();
    },
  };
}
