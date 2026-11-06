# market-data: architecture

Herdr loads `main.js` and its imports as plain ES modules. There is no build step: what's in this
folder is what runs. Types are JSDoc, checked by `tsc --checkJs` (see the repo's `tsconfig.json`).

## Runtime rules (Herdr's script runtime is not Node and not a browser)

- Globals: `fetch` (no `headers` on the response, so it can't read cookies), `console`,
  `localStorage`, `sessionStorage`, `process` (via `import process from "process"`), `TextDecoder`
  (maybe). No `setTimeout`: wait with `await cx.sleep(ms)` and repeat with `cx.timer.every`.
- Built-in modules: `herdr` (exec, theme, settings, props, openOverlay, closeOverlay, notify),
  `gpui-kit` (View, div, svg), `gpui-base` (v_flex, h_flex, InputState, Input), `websocket`.
  Declarations: `types/herdr.d.ts`, `types/gpui-kit.d.ts`.
- Relative imports must name the file: `./src/domain/format.js`.
- No side effects at module top level, like reading `localStorage`. Herdr re-runs a module's
  top level on every save.
- A `cx` is only valid during the call that received it. Never keep one across an `await`; use
  the `cx` a task or handler is given.

## Layers

Dependencies point down only. `domain` imports nothing outside `domain`. `data` imports `domain`.
`state` imports `domain` and `data`. `ui` imports all three. Only `ui`/`state`/`main.js` touch
`herdr`/`gpui-*`. The one exception is `data/index.js`, which wires the runtime's real defaults
(`exec` from `herdr`, `process.platform`) into the clients.

```
main.js                  entry: Herdr props → TileView (the watchlist) or DetailView (the popup)
src/
  domain/                pure functions, no I/O, fully unit-tested
    markets.js           Market type, parseMarket, yahooSymbol, binanceSymbol
    format.js            prices, changes, big numbers, tiny prices, times, Yahoo {raw,fmt} values
    chart.js             RANGES, niceTicks, bucket (downsampling), yScale, hoverIndex, rangeChange
    quote.js             Yahoo quoteSummary → header, stat sections (per quote type), about
    search.js            parseQuery (type words), toSuggestion, binanceMatches, rankSuggestions,
                         buildSuggestions
    messages.js          stream messages: parseBinanceTicker, parseAlpacaMessages
  data/                  network clients; every dependency is injected, defaulting to the runtime's
    http.js              getJson, HttpError
    alpaca.js            keys (env via exec), snapshot/quotes/bars → history, stream URL
    binance.js           history (klines), ticker24h, pairs (cached), stream URL
    fx.js                FX history: Yahoo chart, Frankfurter (ECB) fallback
    yahoo-session.js     cookie + crumb through curl (exec), persisted, refreshed on 401/403
    yahoo.js             chart, search (raw quotes), quoteSummary
    index.js             createDataSources(deps): the wired-up set the state layer uses
  state/                 behaviour without pixels: testable with a fake cx
    watchlist.js         the list (persisted), rows (price/ref/spark/flash/err), polling, refresh
    streams.js           websocket loops with backoff; feed ticks into the watchlist
    search.js            autocomplete: debounce, newest-answer-wins, cache, highlight, keys
    detail.js            the popup's data: quote, chart per range, Binance 24h, hover, reload
  ui/                    render functions: state in, gpui elements out
    tile-view.js, detail-view.js, chart-view.js, suggestions-view.js, info-panel.js, spark.js,
                         theme.js (theme colors + zoom from herdr)
test/
  unit/                  domain + state, no network
  integration/           data clients against recorded fixtures (fake fetch/exec); views rendered
                         through the recording stubs in ../../test-support
  fixtures/              real API responses, recorded once (see test/fixtures/README.md)
```

## Contracts

```js
/** @typedef {"stock" | "crypto" | "fx"} MarketKind */
/** @typedef {{ id: string, kind: MarketKind, sym: string, ysym?: string }} Market */
//   id = `${kind}:${sym}`; sym: "AAPL", "BRK.B", "BTC/USDT", "EUR/USD"; ysym: Yahoo's own symbol
//   when it can't be derived (PEPE24478-USD).
/** @typedef {"Stock" | "ETF" | "Crypto" | "FX"} SuggestionType */
/** @typedef {{ market: Market, name: string, type: SuggestionType, exchange: string }} Suggestion */
/** @typedef {{ price: number, ref?: number, spark: number[], daily?: boolean }} History */
//   ref: what the % change is measured against (previous close; crypto: 24h open).
/** @typedef {{ meta: object, closes: number[], times: number[] }} ChartData */
```

Data clients take their dependencies explicitly, e.g.
`createYahoo({ fetch, session })`, `createYahooSession({ exec, platform, storage })`,
`createBinance({ fetch })`. `src/data/index.js` wires them to the runtime's globals.

## Behaviour to keep

The rebuild must keep every behaviour of the version before it (git history, commit 8daed29),
including:

- **Search:** Yahoo search; type words; Binance matching; numbered Yahoo crypto symbols (`PEPE24478-USD` → PEPE/USDT, keep `ysym`);
  ranking exact matches first.
- **Chart:** 1D for crypto/FX is a rolling 24h; on a stock's 1D the change and the dashed line are
  measured against the previous close.
- **Formatting:** tiny prices (Yahoo's "0.0000" is replaced); market caps with 2 decimals.
- **Watchlist:** a newer live tick is never stepped back by an older poll.
- **Interaction:** rows ignore presses while the dropdown is open; × doesn't open the popup.
