// The ⓘ panel: how often each kind of price updates.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

/** @typedef {import("./theme.js").Theme} Theme */

/** [name, text] for each line of the panel. */
export const INFO_LINES = [
  ["Crypto", "Live from Binance: every change, about once a second. % change is over the last 24 hours."],
  [
    "Stocks",
    "Live trades from Alpaca (IEX exchange) while the market is open, plus a full check every 15s, which covers pre- and after-hours. % change is against the previous close.",
  ],
  [
    "FX",
    'Every 15s from Yahoo Finance. If Yahoo is down, daily European Central Bank rates (marked "daily"). % change is against the previous close.',
  ],
  ["Charts", "The bars show the last day in 5-minute steps and reload every 5 minutes. ↻ reloads everything now."],
];

/** @param {Theme} t */
export function infoPanel(t) {
  /** @param {string} name @param {string} text */
  const line = (name, text) =>
    h_flex()
      .gap(8)
      .items_start()
      .child(div().w(52).flex_shrink_0().text_size(11).font_semibold().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).child(text));
  return v_flex()
    .mx(10)
    .mb(8)
    .p(10)
    .gap(7)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.popover)
    .child(div().text_size(11.5).font_semibold().text_color(t.foreground).child("How prices update"))
    .children(INFO_LINES.map(([name, text]) => line(name, text)));
}
