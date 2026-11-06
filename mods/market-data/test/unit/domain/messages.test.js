import { describe, it, expect } from "vitest";
import { parseBinanceTicker, parseAlpacaMessages } from "../../../src/domain/messages.js";

describe("parseBinanceTicker", () => {
  it("reads a combined-stream miniTicker", () => {
    const msg = JSON.stringify({
      stream: "btcusdt@miniTicker",
      data: { e: "24hrMiniTicker", E: 1, s: "BTCUSDT", c: "75973.31", o: "80496.00", h: "81000", l: "75000" },
    });
    expect(parseBinanceTicker(msg)).toEqual({ sym: "BTCUSDT", price: 75973.31, ref: 80496 });
  });

  it("reads tiny prices", () => {
    const msg = JSON.stringify({ data: { e: "24hrMiniTicker", s: "PEPEUSDT", c: "0.00000491", o: "0.00000500" } });
    expect(parseBinanceTicker(msg)).toEqual({ sym: "PEPEUSDT", price: 0.00000491, ref: 0.000005 });
  });

  it.each([
    ["not json"],
    [""],
    ["null"],
    ["{}"],
    [JSON.stringify({ data: null })],
    [JSON.stringify({ data: { e: "trade", s: "BTCUSDT", p: "1" } })],
    [JSON.stringify({ result: null, id: 1 })],
  ])("ignores %j", (text) => {
    expect(parseBinanceTicker(text)).toBeNull();
  });
});

describe("parseAlpacaMessages", () => {
  it("returns the events of a message", () => {
    const events = [
      { T: "success", msg: "authenticated" },
      { T: "t", S: "AAPL", p: 344.17, s: 100 },
      { T: "error", code: 402, msg: "auth failed" },
    ];
    expect(parseAlpacaMessages(JSON.stringify(events))).toEqual(events);
  });

  it.each([["not json"], [""], ["null"], ['{"T":"t"}'], ["42"]])("returns [] for %j", (text) => {
    expect(parseAlpacaMessages(text)).toEqual([]);
  });
});
