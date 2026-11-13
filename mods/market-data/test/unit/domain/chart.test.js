import { describe, it, expect } from "vitest";
import {
  RANGES,
  chartRequest,
  trimToLast24h,
  niceTicks,
  axisWidth,
  bucket,
  yScale,
  pointCount,
  pointPct,
  nearestIndex,
  chartBase,
  changePct,
  pointChange,
  rangeChange,
} from "../../../src/domain/chart.js";

describe("RANGES", () => {
  it("lists Yahoo's ranges with their intervals", () => {
    expect(RANGES.map((r) => `${r.key}:${r.label}:${r.interval}`)).toEqual([
      "1d:1D:5m",
      "5d:5D:15m",
      "1mo:1M:1h",
      "6mo:6M:1d",
      "ytd:YTD:1d",
      "1y:1Y:1d",
      "5y:5Y:1wk",
      "max:Max:1mo",
    ]);
  });
});

describe("chartRequest", () => {
  it("asks for 2 days on a rolling 1D", () => {
    expect(chartRequest("1d", true)).toEqual({ span: "2d", interval: "5m", rolling: true });
  });

  it("asks for the range itself otherwise", () => {
    expect(chartRequest("1d")).toEqual({ span: "1d", interval: "5m", rolling: false });
    expect(chartRequest("5d", true)).toEqual({ span: "5d", interval: "15m", rolling: false });
    expect(chartRequest("max")).toEqual({ span: "max", interval: "1mo", rolling: false });
  });

  it("uses 1D's interval for an unknown range", () => {
    expect(chartRequest("2y")).toEqual({ span: "2y", interval: "5m", rolling: false });
  });
});

describe("trimToLast24h", () => {
  it("keeps the points within 24h of the last one", () => {
    const times = [0, 3600, 86400, 90000, 172800];
    const closes = [1, 2, 3, 4, 5];
    expect(trimToLast24h(closes, times)).toEqual({ closes: [3, 4, 5], times: [86400, 90000, 172800] });
    expect(closes).toEqual([1, 2, 3, 4, 5]); // not mutated
  });

  it("keeps everything when it all fits", () => {
    const closes = [1, 2],
      times = [100, 200];
    const r = trimToLast24h(closes, times);
    expect(r).toEqual({ closes: [1, 2], times: [100, 200] });
    expect(r.closes).not.toBe(closes);
  });

  it("handles no points", () => {
    expect(trimToLast24h([], [])).toEqual({ closes: [], times: [] });
  });
});

describe("niceTicks", () => {
  it.each([
    [0, 10, 5, [0, 2, 4, 6, 8, 10], 0],
    [0, 5, 5, [0, 1, 2, 3, 4, 5], 0],
    [0, 20, 5, [0, 5, 10, 15, 20], 0],
    [0, 30, 5, [0, 10, 20, 30], 0],
    [1, 9, 5, [2, 4, 6, 8], 0],
    [70000, 80000, 5, [70000, 72000, 74000, 76000, 78000, 80000], 0],
    [1.1, 1.13, 5, [1.1, 1.11, 1.12, 1.13], 2],
    [1.1, 1.12, 5, [1.1, 1.105, 1.11, 1.115, 1.12], 3],
  ])("%d..%d (%d) → %j, %d decimals", (lo, hi, count, ticks, decimals) => {
    expect(niceTicks(lo, hi, count)).toEqual({ ticks, decimals });
  });

  it("adds a decimal for a 2.5 step", () => {
    expect(niceTicks(0, 12, 5)).toEqual({ ticks: [0, 2.5, 5, 7.5, 10], decimals: 1 });
    expect(niceTicks(0, 1.2, 5)).toEqual({ ticks: [0, 0.25, 0.5, 0.75, 1], decimals: 2 });
    expect(niceTicks(0, 120, 5)).toEqual({ ticks: [0, 25, 50, 75, 100], decimals: 0 });
  });

  it("handles tiny prices", () => {
    const { ticks, decimals } = niceTicks(0.0000047, 0.0000049, 5);
    expect(decimals).toBe(8);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBeCloseTo(0.0000047, 12);
    expect(ticks.at(-1)).toBeCloseTo(0.0000049, 12);
  });

  it("caps decimals at 8", () => {
    expect(niceTicks(0, 1e-10, 5).decimals).toBe(8);
  });

  it("makes up a span when lo equals hi", () => {
    expect(niceTicks(100, 100, 5)).toEqual({ ticks: [100], decimals: 1 });
    expect(niceTicks(0, 0, 5)).toEqual({ ticks: [0], decimals: 1 });
  });
});

describe("axisWidth", () => {
  it("fits the longest label, at least 64", () => {
    expect(axisWidth(["75,973.31", "76,000.00"])).toBeCloseTo(79.6);
    expect(axisWidth(["1.00"])).toBe(64);
    expect(axisWidth(["0.00000491", "0.000005"])).toBe(86);
  });
});

describe("bucket", () => {
  it("keeps every value when they fit", () => {
    expect(bucket([1, 2, 3], 8)).toEqual({ idx: [0, 1, 2], pts: [1, 2, 3] });
    expect(bucket([1, 2, 3], 3)).toEqual({ idx: [0, 1, 2], pts: [1, 2, 3] });
    expect(bucket([], 8)).toEqual({ idx: [], pts: [] });
  });

  it("shows the last value of each bucket when there are more values than bars", () => {
    const values = Array.from({ length: 10 }, (_, i) => i * 10);
    expect(bucket(values, 4)).toEqual({ idx: [1, 4, 6, 9], pts: [10, 40, 60, 90] });
  });

  it("always ends on the last value", () => {
    const values = Array.from({ length: 288 }, (_, i) => i);
    const { idx, pts } = bucket(values, 50);
    expect(idx).toHaveLength(50);
    expect(idx.at(-1)).toBe(287);
    expect(pts.at(-1)).toBe(287);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe("yScale", () => {
  it("pads 10% below and 6% above", () => {
    const s = yScale([10, 20, 15], 100);
    expect(s.lo).toBe(10);
    expect(s.hi).toBe(20);
    expect(s.dlo).toBe(9);
    expect(s.dhi).toBeCloseTo(20.6);
    expect(s.y(s.dlo)).toBeCloseTo(100);
    expect(s.y(s.dhi)).toBeCloseTo(0);
    expect(s.y(20)).toBeCloseTo((1 - 11 / 11.6) * 100);
    expect(s.y(10)).toBeCloseTo((1 - 1 / 11.6) * 100);
  });

  it("widens to the base", () => {
    const below = yScale([10, 20], 100, 5);
    expect([below.lo, below.hi, below.dlo]).toEqual([5, 20, 3.5]);
    expect(below.dhi).toBeCloseTo(20.9);
    const above = yScale([10, 20], 100, 30);
    expect([above.lo, above.hi]).toEqual([10, 30]);
    const inside = yScale([10, 20], 100, 15);
    expect([inside.lo, inside.hi]).toEqual([10, 20]);
    expect(yScale([10, 20], 100, null).lo).toBe(10);
  });

  it("makes up a span for a flat line", () => {
    const s = yScale([5, 5], 170);
    expect(s.dlo).toBeCloseTo(4.995);
    expect(s.dhi).toBeCloseTo(5.003);
    const z = yScale([0, 0], 170);
    expect(z.dlo).toBeCloseTo(-0.1);
    expect(z.dhi).toBeCloseTo(0.06);
    expect(z.y(0)).toBeCloseTo((1 - 0.1 / 0.16) * 170);
  });
});

describe("pointCount", () => {
  it("is one point per 2 px, at least 2", () => {
    expect(pointCount(500)).toBe(250);
    expect(pointCount(501)).toBe(250);
    expect(pointCount(1)).toBe(2);
  });
});

describe("pointPct", () => {
  it("spreads points edge to edge", () => {
    expect(pointPct(0, 11)).toBe(0);
    expect(pointPct(5, 11)).toBe(50);
    expect(pointPct(10, 11)).toBe(100);
    expect(pointPct(0, 1)).toBe(50);
  });
});

describe("nearestIndex", () => {
  it.each([
    [0, 100, 11, 0],
    [4.9, 100, 11, 0],
    [5, 100, 11, 1],
    [50, 100, 11, 5],
    [96, 100, 11, 10],
    [100, 100, 11, 10],
    [150, 100, 11, 10],
    [-5, 100, 11, 0],
  ])("x=%d of %d with %d points → %d", (x, w, n, want) => {
    expect(nearestIndex(x, w, n)).toBe(want);
  });

  it("is null without a width", () => {
    expect(nearestIndex(5, 0, 10)).toBeNull();
    expect(nearestIndex(5, undefined, 10)).toBeNull();
  });
});

describe("chartBase", () => {
  it("uses the previous close on a stock's 1D", () => {
    expect(chartBase([10, 11], { chartPreviousClose: 9, previousClose: 8 }, "1d", "stock")).toBe(9);
    expect(chartBase([10, 11], { previousClose: 8 }, "1d", "stock")).toBe(8);
    expect(chartBase([10, 11], {}, "1d", "stock")).toBe(10);
    expect(chartBase([10, 11], null, "1d", "stock")).toBe(10);
  });

  it("uses the first point otherwise", () => {
    expect(chartBase([10, 11], { chartPreviousClose: 9 }, "5d", "stock")).toBe(10);
    expect(chartBase([10, 11], { chartPreviousClose: 9 }, "1d", "crypto")).toBe(10);
    expect(chartBase([10, 11], { chartPreviousClose: 9 }, "1d", "fx")).toBe(10);
  });
});

describe("changePct / pointChange", () => {
  it("formats the change against the base", () => {
    expect(changePct(110, 100)).toBe("+10.00%");
    expect(changePct(90, 100)).toBe("-10.00%");
    expect(changePct(99.99, 100)).toBe("-0.01%");
    expect(changePct(100, 100)).toBe("+0.00%");
  });

  it("gives the hover tip's change in the price's decimals", () => {
    expect(pointChange(110, 100)).toBe("+10.00 (+10.00%)");
    expect(pointChange(1.1213, 1.12)).toBe("+0.001300 (+0.11%)");
    expect(pointChange(0.00000491, 0.000005)).toBe("-0.00000009000 (-1.80%)");
  });
});

describe("rangeChange", () => {
  it("measures a stock's 1D against the previous close", () => {
    expect(rangeChange([100, 105, 110], { chartPreviousClose: 120 }, "1d", "stock")).toEqual({
      base: 120,
      last: 110,
      up: false,
      stock1d: true,
      pct: "-8.33%",
      summary: "-8.33% today",
    });
  });

  it("says 'in 24h' for crypto and FX", () => {
    expect(rangeChange([100, 105, 110], { chartPreviousClose: 120 }, "1d", "crypto")).toEqual({
      base: 100,
      last: 110,
      up: true,
      stock1d: false,
      pct: "+10.00%",
      summary: "+10.00% in 24h",
    });
    expect(rangeChange([1.2, 1.1], {}, "1d", "fx").summary).toBe("-8.33% in 24h");
  });

  it("names longer ranges", () => {
    expect(rangeChange([100, 110], null, "6mo", "stock").summary).toBe("+10.00% over 6M");
    expect(rangeChange([100, 110], null, "ytd", "crypto").summary).toBe("+10.00% over YTD");
    expect(rangeChange([100, 110], null, "2y", "stock").summary).toBe("+10.00% over 2y");
  });

  it("counts flat as up", () => {
    expect(rangeChange([5, 5], null, "5d", "stock")).toMatchObject({ up: true, pct: "+0.00%" });
  });
});
