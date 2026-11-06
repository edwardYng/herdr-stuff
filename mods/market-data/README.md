# market-data

A Herdr tile with a watchlist of stocks, crypto and FX pairs. It shows live prices, the day's change and a sparkline for each one.

## Requirements

- **Herdr desktop app** (`herdr-app`).
- **Network access** to:
  - `data.alpaca.markets` and `stream.data.alpaca.markets` (stocks)
  - `api.binance.com` and `stream.binance.com` (crypto)
  - `query1.finance.yahoo.com` (FX), with `api.frankfurter.dev` (ECB daily rates) as the fallback
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

- Click × on a row to remove it. Use the refresh button to update everything now.
- Prices stream live (Alpaca and Binance websockets) and are also polled every 15 s. Sparklines are re-fetched every 5 min.
- If Yahoo fails, FX falls back to ECB daily rates, which are not live.
- The watchlist is saved in `~/.config/herdr-app/data/market-data/store.json`.

## Files

- `main.js`: the tile (UI, watchlist, timers, websockets)
- `feeds.js`: data sources, symbol parsing, formatting
- `mod.json`: where the tile docks first and how big it is
- `*.svg`: icons
