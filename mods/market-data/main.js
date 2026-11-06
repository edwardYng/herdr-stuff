// Market Data: a watchlist tile with live prices, and (opened again as a dialog) a Yahoo
// Finance–style details popup for one market. See ARCHITECTURE.md.
import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import { props } from "herdr";
import { createDataSources } from "./src/data/index.js";
import { Watchlist } from "./src/state/watchlist.js";
import { Streams } from "./src/state/streams.js";
import { Search, PLACEHOLDER } from "./src/state/search.js";
import { Detail } from "./src/state/detail.js";
import { tileView } from "./src/ui/tile-view.js";
import { detailView } from "./src/ui/detail-view.js";
import { readTheme, readZoom } from "./src/ui/theme.js";

/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").Context} Context */

export default class Markets extends View {
  /**
   * @param {unknown} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    const data = createDataSources();
    /** @type {{ width?: number, infoHover?: boolean, infoPinned?: boolean }} */
    this.ui = {};
    // Opened again as the popup for one market (see openDetail in src/ui/tile-view.js).
    const p = props();
    if (p?.market) {
      this.detail = new Detail(p, { data });
      this.detail.start(cx);
      return;
    }
    const watchlist = new Watchlist({ data, storage: localStorage });
    const streams = new Streams({ watchlist, data });
    watchlist.onStreamChange = (kind, cx) => streams.restart(kind, cx);
    this.watchlist = watchlist;
    this.streams = streams;
    this.search = new Search({
      input: InputState.new({ placeholder: PLACEHOLDER }),
      data,
      onPick: (m, cx) => watchlist.add(m, cx),
    });
    watchlist.start(cx);
  }

  /** @param {Context} _cx */
  render(_cx) {
    const t = readTheme();
    const zoom = readZoom();
    if (this.detail) return detailView(this.detail, this.ui, t, zoom);
    return tileView({ watchlist: this.watchlist, search: this.search, ui: this.ui, zoom }, t);
  }

  async close() {
    await this.streams?.close();
  }
}
