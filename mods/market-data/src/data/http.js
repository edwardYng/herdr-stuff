// HTTP plumbing shared by the data clients. `fetch` is always passed in: Herdr's global in the
// app, a fake in tests.

/** The browser Yahoo expects; also sent to the chart and search endpoints. */
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/**
 * The part of Herdr's fetch response the clients use (it has no `headers`).
 * @typedef {{ ok: boolean, status: number, json(): Promise<any> }} FetchResponse
 */
/**
 * Herdr's global `fetch`, or anything shaped like it.
 * @typedef {(url: string, options?: { headers?: Record<string, string> }) => Promise<FetchResponse>} FetchFn
 */

/**
 * A request that got an answer other than 2xx, or none at all (status 0). `message` is the status
 * ("404") unless given, so code that matches on the message keeps working.
 */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status; 0 when there was no usable answer.
   * @param {string} [url]
   * @param {string} [message]
   */
  constructor(status, url, message) {
    super(message ?? (status ? String(status) : "offline"));
    this.name = "HttpError";
    /** @type {number} */
    this.status = status;
    /** @type {string | undefined} */
    this.url = url;
  }
}

/**
 * GETs `url` and parses the JSON body.
 * @param {FetchFn} fetch
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 * @throws {HttpError} on a non-2xx status. Network failures reject with fetch's own error.
 */
export async function getJson(fetch, url, headers) {
  const r = await fetch(url, headers ? { headers } : undefined);
  if (!r.ok) throw new HttpError(r.status, url);
  return r.json();
}

/**
 * What a row shows for a failed request: "not found" for a 4xx, else "offline".
 * @param {unknown} e
 * @returns {"not found" | "offline"}
 */
export function errorLabel(e) {
  return e instanceof HttpError && e.status >= 400 && e.status < 500 ? "not found" : "offline";
}
