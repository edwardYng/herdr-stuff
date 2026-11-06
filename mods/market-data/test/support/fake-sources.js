// A stand-in for createDataSources(): every client method is a vi.fn with a plausible default
// answer. Override per client: fakeSources({ yahoo: { search: vi.fn(...) } }).
import { vi } from "vitest";
import { readFileSync } from "node:fs";

const FIXTURES = new URL("../fixtures/", import.meta.url);

/** A fixture, parsed. @param {string} path relative to test/fixtures */
export const fixture = (path) => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));

/** A recorded quoteSummary result (yahoo/quoteSummary-<sym>.json). @param {string} sym */
export const quoteSummaryFixture = (sym) => fixture(`yahoo/quoteSummary-${sym}.json`);

/** A recorded chart answer turned into what yahoo.chart() returns. @param {string} file e.g. "AAPL-1d" */
export function chartFixture(file) {
  const r = fixture(`yahoo/chart/${file}.json`).chart.result[0];
  const closes = [];
  const times = [];
  r.indicators.quote[0].close.forEach((c, i) => {
    if (c != null) {
      closes.push(c);
      times.push(r.timestamp[i]);
    }
  });
  return { meta: r.meta, closes, times };
}

export const KEYS = { key: "kid", secret: "sec" };

/** A history answer. */
export const history = (price, ref, spark = [price - 1, price]) => ({ price, ref, spark });

/**
 * @param {Record<string, any>} [o] per-client overrides, merged into the defaults
 */
export function fakeSources(o = {}) {
  const base = {
    alpaca: {
      history: vi.fn(async () => history(200, 190)),
      quotes: vi.fn(async () => ({})),
    },
    alpacaKeys: vi.fn(async () => KEYS),
    alpacaStream: "wss://alpaca.test/v2/iex",
    binance: {
      history: vi.fn(async () => history(50000, 49000)),
      ticker24h: vi.fn(async () => fixture("binance/ticker24hr-BTCUSDT.json")),
      pairs: vi.fn(async () => new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "PEPEUSDT", "ARBUSDT"])),
      streamUrl: (syms) => `wss://binance.test/${syms.join(",")}`,
    },
    fx: { history: vi.fn(async () => history(1.1, 1.09)) },
    yahoo: {
      chart: vi.fn(async () => chartFixture("AAPL-1d")),
      search: vi.fn(async () => []),
      quoteSummary: vi.fn(async () => quoteSummaryFixture("AAPL")),
    },
    yahooSession: { get: vi.fn(), current: vi.fn(() => null) },
  };
  for (const [k, v] of Object.entries(o)) {
    base[k] = v && typeof v === "object" && !(v instanceof Function) ? { ...base[k], ...v } : v;
  }
  return /** @type {any} */ (base);
}

/** An in-memory localStorage. */
export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

/** Lets pending promise callbacks (and a macrotask) run. */
export const settle = () => new Promise((r) => setTimeout(r, 0));
