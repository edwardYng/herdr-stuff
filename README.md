# herdr-stuff

My own mods (and later layouts, themes, etc.) for the Herdr desktop app.

## Layout

```
mods/
  market-data/   watchlist tile with live prices (stocks via Alpaca, crypto via Binance, FX via Yahoo/Frankfurter)
```

## Install a mod

Herdr loads mods from `~/.config/herdr-app/mods/<name>/`. Link the folder there so edits in this repo are live.

Windows (directory junction, no admin needed):

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.config\herdr-app\mods\market-data" -Target "$PWD\mods\market-data"
```

macOS / Linux:

```sh
ln -s "$PWD/mods/market-data" ~/.config/herdr-app/mods/market-data
```

Then check it:

```sh
herdr-app check ~/.config/herdr-app/mods/market-data
```

## market-data

- Stocks need Alpaca keys in the environment: `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` (free IEX plan works). Crypto and FX need no keys.
- Reaches the network: `data.alpaca.markets`, Binance, Yahoo Finance, Frankfurter.
