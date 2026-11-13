# herdr-stuff

My own mods (and later layouts, themes, etc.) for the Herdr desktop app.

## Layout

```
mods/
  market-data/   watchlist tile with live prices (stocks via Alpaca, crypto via Binance, FX via Yahoo/Frankfurter)
  mod-launcher/  palette that lists your mods and opens one in a pane to the right (Shift+Enter: a new tab)
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

**Edits through the link don't reload a running tile.** Herdr doesn't see changes made through a junction or symlink, so a docked copy keeps running the old code until Herdr restarts. `herdr-app do mod.open '{"name":"<mod>"}'` opens a fresh copy as an overlay with the current files; run it again to close it.

## Development

Mods are plain ES modules that Herdr loads as-is, with no build step. The tooling at the repo root is for development only:

| Command                           | What it does                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `npm ci`                          | install the dev tools                                                                |
| `npm test`                        | unit and integration tests (Vitest); `npm run test:unit`, `npm run test:integration` |
| `npm run coverage`                | tests with a coverage report in `coverage/`                                          |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                    |
| `npm run typecheck`               | `tsc --checkJs` over the mods' JSDoc types, against Herdr's own declarations         |
| `npm run check`                   | all of the above, as CI runs them                                                    |
| `npm run herdr:check`             | `herdr-app check` on market-data (needs Herdr installed)                             |
| `npm run sync-types`              | refresh `types/*.d.ts` from `~/.config/herdr-app` after a Herdr update               |

- **Tests in Node:** Herdr's built-in modules (`herdr`, `gpui-kit`, `gpui-base`, `websocket`) don't exist in Node. Tests get recording fakes from `test-support/stubs` (aliased in `vitest.config.js`), so views can be rendered and their handlers fired.
- **Live tests:** `LIVE=1 npm run test:integration` also hits the real APIs.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs `npm run check` on Node 22 and 24.

Each mod documents its own layout, e.g. [`mods/market-data/ARCHITECTURE.md`](mods/market-data/ARCHITECTURE.md).

## market-data

- Stocks need Alpaca keys in the environment: `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` (free IEX plan works). Crypto and FX need no keys.
- Reaches the network: `data.alpaca.markets`, Binance, Yahoo Finance, Frankfurter.
