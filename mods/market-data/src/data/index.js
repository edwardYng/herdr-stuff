// The data clients wired to Herdr's runtime: global fetch, herdr's exec, process.platform and
// localStorage. Every default is looked up when it's used, never at module load; tests and other
// callers can pass their own.
import { exec as herdrExec } from "herdr";
import process from "process";
import { createAlpaca, readAlpacaKeys, ALPACA_STREAM } from "./alpaca.js";
import { createBinance } from "./binance.js";
import { createFx } from "./fx.js";
import { createYahooSession } from "./yahoo-session.js";
import { createYahoo } from "./yahoo.js";

export { HttpError, errorLabel } from "./http.js";

/** @typedef {import("./http.js").FetchFn} FetchFn */
/** @typedef {import("./alpaca.js").ExecFn} ExecFn */
/** @typedef {import("./yahoo-session.js").StorageLike} StorageLike */
/**
 * @typedef {{ fetch?: FetchFn, exec?: ExecFn, platform?: string, storage?: StorageLike | null,
 *   now?: () => number }} DataDeps
 */

/** @type {FetchFn} */
const globalFetch = (url, options) => fetch(url, options);
/** @type {ExecFn} */
const defaultExec = (command, args) => herdrExec(command, args);
/** @type {StorageLike} */
const globalStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

/**
 * Everything the state layer needs from the network.
 * @param {DataDeps} [deps]
 */
export function createDataSources(deps = {}) {
  const fetchFn = deps.fetch ?? globalFetch;
  const exec = deps.exec ?? defaultExec;
  const platform = deps.platform ?? process.platform;
  const storage = deps.storage === undefined ? globalStorage : deps.storage;
  const now = deps.now ?? Date.now;
  const session = createYahooSession({ exec, platform, storage });
  return {
    alpaca: createAlpaca({ fetch: fetchFn, now }),
    /** @returns {Promise<import("./alpaca.js").AlpacaKeys | null>} */
    alpacaKeys: () => readAlpacaKeys({ exec, platform }),
    alpacaStream: ALPACA_STREAM,
    binance: createBinance({ fetch: fetchFn }),
    fx: createFx({ fetch: fetchFn, now }),
    yahoo: createYahoo({ fetch: fetchFn, session }),
    yahooSession: session,
  };
}

/** @typedef {ReturnType<typeof createDataSources>} DataSources */
