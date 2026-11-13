# mod-launcher

A palette for opening mods, in the style of Herdr's Cmd+Shift+P palette. It lists every mod in `~/.config/herdr-app/mods`: your own first, then Herdr's panels (Agents, Spaces, Tabs, changes, files). Herdr's menus, dialogs and toasts are left out.

## Use

| Key                        | Does                                                   |
| -------------------------- | ------------------------------------------------------ |
| type                       | filter by name, title or description                   |
| ↑ / ↓                      | choose                                                 |
| Enter or click             | open the mod in a pane to the right of the focused one |
| Shift+Enter or Shift+click | open the mod in a new tab                              |
| Esc                        | close                                                  |

With no pane focused, Enter opens a new tab. To put the pane somewhere else, drag it.

Each row shows the first sentence of the mod's top `//` comment as its description, and the `title` from its `mod.json` when it has one.

## Install

Link this folder into Herdr's mods folder. From the repo root:

```sh
ln -s "$PWD/mods/mod-launcher" ~/.config/herdr-app/mods/mod-launcher
herdr-app check ~/.config/herdr-app/mods/mod-launcher
```

Then bind a key in `~/.config/herdr-app/keys.json`, under `global`:

```json
"cmd-shift-m": "mod.open:mod-launcher"
```

Or open it from a shell: `herdr-app do mod.open '{"name":"mod-launcher"}'`.

## Files

- `main.js`: the palette
- `mod.json`: opens as a popup at the top of the window, never docked
