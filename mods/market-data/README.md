# market-data

A Herdr tile with a watchlist of stocks, crypto and FX pairs. It shows live prices, the day's change and a sparkline for each one.

## Requirements

- **Herdr desktop app** (`herdr-app`).
- **Network access** to:
  - `data.alpaca.markets` and `stream.data.alpaca.markets` (stocks)
  - `api.binance.com` and `stream.binance.com` (crypto)
  - `query1.finance.yahoo.com` (FX, and the details popup), with `api.frankfurter.dev` (ECB daily rates) as the fallback
  - `fc.yahoo.com` (the cookie Yahoo needs for the details popup)
- **curl** on the PATH (built into Windows 10+ and macOS). The details popup uses it to get Yahoo's cookie, because the mod's `fetch` can't read cookies. Without curl the popup still shows the chart and the basics.
- **Alpaca API keys**, needed for stocks only. Crypto and FX work without them.
  - Get a free account at <https://alpaca.markets>. The free plan's IEX feed is enough.
  - The mod runs a shell command (`powershell` on Windows, `sh` elsewhere) to read the keys.

## Set the Alpaca keys

The mod reads two environment variables: `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`. It checks for them again every 15 s, so you don't need to restart Herdr after setting them.

**Windows:** set them as *User* variables (the mod reads them from there):

```powershell
[Environment]::SetEnvironmentVariable('APCA_API_KEY_ID', '<your key id>', 'User')
[Environment]::SetEnvironmentVariable('APCA_API_SECRET_KEY', '<your secret>', 'User')
```

**macOS / Linux:** export them in your login shell profile (e.g. `~/.profile` or `~/.zprofile`). The mod reads them with `sh -lc`:

```sh
export APCA_API_KEY_ID='<your key id>'
export APCA_API_SECRET_KEY='<your secret>'
```

If the keys are missing, the header shows "no Alpaca keys" and stock rows show "set Alpaca keys".

## Install

Link this folder into Herdr's mods folder. From the repo root:

```powershell
# Windows (directory junction, no admin needed)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.config\herdr-app\mods\market-data" -Target "$PWD\mods\market-data"
```

```sh
# macOS / Linux
ln -s "$PWD/mods/market-data" ~/.config/herdr-app/mods/market-data
```

Check it loads:

```sh
herdr-app check ~/.config/herdr-app/mods/market-data
```

The first time Herdr sees the folder, it docks the tile on the right (340 px, set in `mod.json`). To open it as a pane next to an existing one instead:

```sh
herdr-app do pane.split '{"direction":"right","mod":"market-data"}'
```

## Use

Type a symbol in the box and press Enter:

| Input | Treated as |
|---|---|
| `AAPL`, `NVDA` | stock (Alpaca) |
| `BTC/USDT`, `ETHUSDT`, `SOL-USDC` | crypto (Binance) |
| `EUR/USD`, `USDJPY` | FX (Yahoo Finance) |
| `stock:…`, `crypto:…`, `fx:…` | forces the type |

- Start typing in the box for suggestions (stocks and ETFs on US exchanges, crypto pairs on Binance, including coins Yahoo misses, FX). ↑/↓ choose, Enter or a click adds, Esc closes. Add a type word to narrow the results: `sui crypto`, `coin stock`, `gold etf`, `eur fx` (also `coin`/`token`, `share`/`equity`, `fund`, `forex`/`currency`). Explicit forms like `BTC/USDT` or `stock:…` skip the suggestions.
- Click a row to open a details popup, like a Yahoo Finance quote page:
  - name, exchange, currency and market status, plus the pre-market or after-hours price
  - a chart with 1D / 5D / 1M / 6M / YTD / 1Y / 5Y / Max ranges and a price axis. Hover it for a crosshair showing the price, the change and the time at that point. On a stock's 1D chart, a dashed line marks the previous close.
  - the key stats for that type of quote:
    - **Stocks:** previous close, open, bid/ask, day and 52-week ranges, volume, market cap, beta, P/E, EPS, earnings date, dividend, 1y target, plus valuation and financials
    - **ETFs:** net assets, NAV, yield, YTD return, expense ratio, inception date
    - **Crypto:** market cap, supply, 24h volume, plus the pair's own 24h stats on Binance
    - **FX:** bid/ask, ranges, 50- and 200-day averages
  - an About section (sector, industry, description, website) and a link to the Yahoo page

  The popup reloads every 30 s. Esc or × closes it.
- Click × on a row to remove it. Use the refresh button to update everything now.
- Prices stream live (Alpaca and Binance websockets) and are also polled every 15 s. Sparklines are re-fetched every 5 min.
- If Yahoo fails, FX falls back to ECB daily rates, which are not live.
- The watchlist is saved in `~/.config/herdr-app/data/market-data/store.json`.

## Files

- `main.js`: the tile (UI, watchlist, timers, websockets)
- `feeds.js`: data sources, symbol parsing, formatting
- `detail.js`: the details popup (this same mod, opened again as a dialog)
- `yahoo.js`: Yahoo Finance details, its cookie and crumb, and the popup chart
- `mod.json`: where the tile docks first and how big it is
- `*.svg`: icons
