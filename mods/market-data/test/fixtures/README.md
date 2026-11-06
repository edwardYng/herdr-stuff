# Fixtures

Real API responses, recorded once with curl on 2026-11-05 (US market close, ~21:09 UTC) and used by
the integration tests' fake fetch / fake curl (`test/integration/data/fakes.js`). Nothing here holds
keys or personal cookies. To re-record, run the same commands; tests derive expected values from the
files, so new recordings shouldn't need test changes (beyond dates in `alpaca/` and `frankfurter/`).

`UA` below is the Chrome user agent in `src/data/http.js`.

## yahoo/

| File | Captured with |
| --- | --- |
| `chart/AAPL-1d.json` | `curl -s --compressed -A "$UA" "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m"` |
| `chart/BTC-USD-2d.json` | same, `BTC-USD?range=2d&interval=5m` (the rolling-24h request) |
| `chart/EURUSD-2d.json` | same, `EURUSD%3DX?interval=5m&range=2d` (the FX history request) |
| `chart/notfound.json` | same, `NOPEXYZQ?range=1d&interval=5m` (HTTP 404) |
| `search/apple.json` | `curl -s --compressed -A "$UA" "https://query1.finance.yahoo.com/v1/finance/search?q=apple&quotesCount=12&newsCount=0&listsCount=0"` |
| `session/fc-yahoo-curl-stdout.txt` | `curl -s --compressed --max-time 12 -A "$UA" -w "\n%{http_code}" -i https://fc.yahoo.com` (curl's whole stdout: headers, body, status). **The A3 cookie value was replaced** with `d=AQABBFAKEFAKE&S=AQAAAFAKEFAKE`. |
| `summary/AAPL.json` | with that cookie and the crumb from `curl ... -H "Cookie: A3=..." https://query1.finance.yahoo.com/v1/test/getcrumb`: `curl ... -H "Cookie: A3=..." "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryDetail,defaultKeyStatistics,calendarEvents,financialData,assetProfile,fundProfile&crumb=<crumb>"` |
| `summary/notfound.json` | same, symbol `NOPEXYZQ` (HTTP 404) |
| `summary/unauthorized.json` | same for AAPL without the cookie and `crumb=bogus` (HTTP 401, "Invalid Crumb") |

(`yahoo/quoteSummary-*.json`, if present, belong to the domain tests.)

## binance/

| File | Captured with |
| --- | --- |
| `klines-BTCUSDT.json` | `curl -s "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=288"` |
| `ticker24hr-BTCUSDT.json` | `curl -s "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"` |
| `ticker-price.json` | `curl -s "https://api.binance.com/api/v3/ticker/price"`, **trimmed** to the first 60 entries plus BTCUSDT, ETHUSDT, SOLUSDT, PEPEUSDT, ARBUSDT, BNBUSDT, ETHBTC, DOGEUSDT, SUIUSDT (the full list is ~160 KB) |
| `error-invalid-symbol.json` | klines for `NOPENOPE` (HTTP 400) |

## frankfurter/

| File | Captured with |
| --- | --- |
| `EUR-USD-30d.json` | `curl -s "https://api.frankfurter.dev/v1/2026-10-06..2026-11-05?base=EUR&symbols=USD"` (ECB daily rates) |

## alpaca/

Recorded with real keys from the user's environment, passed as headers and never written out:
`curl -s -H "APCA-API-KEY-ID: $K" -H "APCA-API-SECRET-KEY: $S" <url>`.

| File | URL |
| --- | --- |
| `snapshot-AAPL.json` | `https://data.alpaca.markets/v2/stocks/AAPL/snapshot?feed=iex` |
| `bars-AAPL.json` | `https://data.alpaca.markets/v2/stocks/AAPL/bars?timeframe=5Min&feed=iex&sort=desc&limit=78&start=<now − 5 days>` |
| `snapshots-AAPL-MSFT-BRK.B.json` | `https://data.alpaca.markets/v2/stocks/snapshots?feed=iex&symbols=AAPL,MSFT,BRK.B` |
| `snapshot-notfound.json` | `.../v2/stocks/NOPEXYZQ/snapshot?feed=iex` (HTTP 404) |
| `unauthorized.html` | `.../v2/stocks/AAPL/snapshot?feed=iex` without keys (HTTP 401, nginx HTML page) |
