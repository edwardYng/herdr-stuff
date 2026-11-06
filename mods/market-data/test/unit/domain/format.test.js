import { describe, it, expect } from "vitest";
import {
  DASH,
  formatPrice,
  formatChange,
  num,
  big,
  sigDecimals,
  tiny,
  decimalsOf,
  signed,
  percent,
  yFmt,
  yLong,
  yRaw,
  yRange,
  yBidAsk,
  yCap,
  formatChartTime,
  textWidth,
} from "../../../src/domain/format.js";

describe("formatPrice", () => {
  it.each([
    [344.17, "stock", "AAPL", "344.17"],
    [75973.31, "crypto", "BTC/USDT", "75,973.31"],
    [1234567.891, "stock", "X", "1,234,567.89"],
    [1, "crypto", "X/USDT", "1.00"],
    [0.5, "crypto", "X/USDT", "0.5000"],
    [0.01, "crypto", "X/USDT", "0.0100"],
    [0.00000491, "crypto", "PEPE/USDT", "0.00000491"],
    [0, "crypto", "X/USDT", "0.00000000"],
    [1.1213276, "fx", "EUR/USD", "1.1213"],
    [153.4567, "fx", "USD/JPY", "153.457"],
    [0.0066, "fx", "JPY/USD", "0.007"],
    [19.99, "fx", "USD/MXN", "19.9900"],
    [20.5, "fx", "USD/MXN", "20.500"],
    [1350.25, "fx", "USD/KRW", "1,350.250"],
  ])("%d %s %s → %s", (p, kind, sym, want) => {
    expect(formatPrice(p, /** @type {any} */ (kind), sym)).toBe(want);
  });

  it("shows a dash without a price", () => {
    expect(formatPrice(null, "stock", "AAPL")).toBe("—");
    expect(formatPrice(undefined, "stock", "AAPL")).toBe("—");
    expect(formatPrice(NaN, "stock", "AAPL")).toBe("—");
    expect(formatPrice(Infinity, "crypto", "BTC/USDT")).toBe("—");
  });

  it("gives negative numbers 8 decimals (reference quirk: the tiers test p, not |p|)", () => {
    expect(formatPrice(-5, "stock", "X")).toBe("-5.00000000");
    expect(formatPrice(-1234, "stock", "X")).toBe("-1,234.00000000");
  });
});

describe("formatChange", () => {
  it.each([
    [110, 100, "+10.00%"],
    [90, 100, "-10.00%"],
    [100, 100, "+0.00%"],
    [0.00000491, 0.000005, "-1.80%"],
    [1.0001, 1, "+0.01%"],
  ])("%d vs %d → %s", (p, ref, want) => {
    expect(formatChange(p, ref)).toBe(want);
  });

  it("is empty without a price or reference", () => {
    expect(formatChange(null, 100)).toBe("");
    expect(formatChange(undefined, 100)).toBe("");
    expect(formatChange(100, null)).toBe("");
    expect(formatChange(100, 0)).toBe("");
    expect(formatChange(100, NaN)).toBe("");
  });

  it("passes NaN prices through (reference quirk)", () => {
    expect(formatChange(NaN, 100)).toBe("NaN%");
  });
});

describe("num", () => {
  it("groups thousands with d decimals", () => {
    expect(num(1234.5)).toBe("1,234.50");
    expect(num(1234.4, 0)).toBe("1,234");
    expect(num(-1234567.891)).toBe("-1,234,567.89");
    expect(num(0.123456, 4)).toBe("0.1235");
    expect(num(167000, 0)).toBe("167,000");
  });

  it("is null for missing or non-finite numbers", () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(-Infinity)).toBeNull();
  });
});

describe("big", () => {
  it.each([
    [5001541320704, "5.00T"],
    [1.5e9, "1.50B"],
    [2.5e6, "2.50M"],
    [1500, "1.50k"],
    [1000, "1.00k"],
    [999, "999.00"],
    [0, "0.00"],
    [-233831202816, "-233.83B"],
    [-1500, "-1.50k"],
  ])("%d → %s", (n, want) => {
    expect(big(n)).toBe(want);
  });

  it("is null for missing or non-finite numbers", () => {
    expect(big(null)).toBeNull();
    expect(big(NaN)).toBeNull();
    expect(big(Infinity)).toBeNull();
  });
});

describe("sigDecimals", () => {
  it.each([
    [0.000004903, 2, 9],
    [0.5, 2, 4],
    [0.05, 2, 5],
    [-0.0012, 2, 6],
    [0.5, 6, 6],
    [1.5, 2, 2],
    [1234, 3, 3],
    [0, 2, 2],
    [1e-15, 2, 12],
  ])("%d (min %d) → %d", (n, min, want) => {
    expect(sigDecimals(n, min)).toBe(want);
  });

  it("defaults min to 2 and treats null as 0", () => {
    expect(sigDecimals(5)).toBe(2);
    expect(sigDecimals(null)).toBe(2);
    expect(sigDecimals(undefined, 4)).toBe(4);
  });
});

describe("tiny", () => {
  it("keeps ~4 significant digits, at least 4 decimals", () => {
    expect(tiny(0.00000491)).toBe("0.000004910");
    expect(tiny(0.00000488)).toBe("0.000004880");
    expect(tiny(-1.8000037e-7)).toBe("-0.0000001800");
    expect(tiny(0.5)).toBe("0.5000");
    expect(tiny(0.00004)).toBe("0.00004000");
  });
});

describe("decimalsOf", () => {
  it.each([
    [344, 2],
    [20, 2],
    [-25, 2],
    [19.99, 4],
    [0.01, 4],
    [0.00000491, 9],
    [0, 4],
  ])("%d → %d", (p, want) => {
    expect(decimalsOf(p)).toBe(want);
  });
});

describe("signed", () => {
  it("signs and formats", () => {
    expect(signed(1.234)).toBe("+1.23");
    expect(signed(-5.34, 2)).toBe("-5.34");
    expect(signed(0)).toBe("+0.00");
    expect(signed(1234.5)).toBe("+1,234.50");
    expect(signed(-4522.6797, 2)).toBe("-4,522.68");
    expect(signed(0.84851074, 4)).toBe("+0.8485");
  });

  it("uses more decimals below 1", () => {
    expect(signed(0.5)).toBe("+0.5000");
    expect(signed(-0.0005031824, 4)).toBe("-0.0005032");
    expect(signed(-1.8000037e-7, 5)).toBe("-0.0000001800");
  });

  it("is empty for null", () => {
    expect(signed(null)).toBe("");
    expect(signed(undefined)).toBe("");
  });
});

describe("percent", () => {
  it.each([
    [1.234, "+1.23"],
    [-1.52785005, "-1.53"],
    [0.5, "+0.50"],
    [0.0199, "+0.01"], // cut, not rounded
    [-0.044858895, "-0.04"],
    [-0.0001, "-0.00"],
    [0, "+0.00"],
    [12.5, "+12.50"],
    [-3.5573196, "-3.56"],
  ])("%d → %s", (n, want) => {
    expect(percent(n)).toBe(want);
  });

  it("is empty for null", () => {
    expect(percent(null)).toBe("");
  });
});

describe("yFmt", () => {
  it("uses Yahoo's short formatting", () => {
    expect(yFmt({ raw: 344.17, fmt: "344.17" })).toBe("344.17");
    expect(yFmt({ raw: 5001541320704, fmt: "5T", longFmt: "5,001,541,320,704" })).toBe("5T");
    expect(yFmt({ raw: 0.0031, fmt: "0.31%" })).toBe("0.31%");
  });

  it("falls back to longFmt", () => {
    expect(yFmt({ raw: 0, fmt: null, longFmt: "0" })).toBe("0");
    expect(yFmt({ longFmt: "1,000" })).toBe("1,000");
  });

  it("replaces a tiny price Yahoo rounded to nothing", () => {
    expect(yFmt({ raw: 0.00000488, fmt: "0.00000" })).toBe("0.000004880");
    expect(yFmt({ raw: 0.00004, fmt: "0.0000" })).toBe("0.00004000");
    expect(yFmt({ raw: -1.8000037e-7, fmt: "-0.00000" })).toBe("-0.0000001800");
  });

  it("keeps a real zero and a non-zero fmt", () => {
    expect(yFmt({ raw: 0, fmt: "0.00000" })).toBe("0.00000");
    expect(yFmt({ raw: 0.000007, fmt: "0.00001" })).toBe("0.00001");
    expect(yFmt({ raw: 0.0001, fmt: "0.0001" })).toBe("0.0001");
  });

  it("handles plain values and nothing", () => {
    expect(yFmt(null)).toBeNull();
    expect(yFmt(undefined)).toBeNull();
    expect(yFmt({})).toBeNull();
    expect(yFmt("SHA-256")).toBe("SHA-256");
    expect(yFmt(38)).toBe("38");
  });
});

describe("yLong", () => {
  it("prefers longFmt", () => {
    expect(yLong({ raw: 74173346, fmt: "74.17M", longFmt: "74,173,346" })).toBe("74,173,346");
    expect(yLong({ raw: 5, fmt: "5" })).toBe("5");
    expect(yLong({})).toBeNull();
    expect(yLong(null)).toBeNull();
    expect(yLong("x")).toBe("x");
    expect(yLong(7)).toBe("7");
  });
});

describe("yRaw", () => {
  it("reads raw", () => {
    expect(yRaw({ raw: 3, fmt: "3.00" })).toBe(3);
    expect(yRaw(5)).toBe(5);
    expect(yRaw(0)).toBe(0);
    expect(yRaw({})).toBeNull();
    expect(yRaw(null)).toBeNull();
    expect(yRaw(undefined)).toBeNull();
    expect(yRaw("text")).toBeNull();
  });
});

describe("yRange", () => {
  it("needs both ends", () => {
    expect(yRange({ raw: 1, fmt: "1.00" }, { raw: 2, fmt: "2.00" })).toBe("1.00 - 2.00");
    expect(yRange({ raw: 0.0000047, fmt: "0.00000" }, { raw: 0.0000049, fmt: "0.00000" })).toBe(
      "0.000004700 - 0.000004900",
    );
    expect(yRange({ raw: 1, fmt: "1.00" }, {})).toBeNull();
    expect(yRange(undefined, { raw: 2, fmt: "2.00" })).toBeNull();
  });
});

describe("yBidAsk", () => {
  it("shows the size when there is one", () => {
    expect(yBidAsk({ raw: 344.02, fmt: "344.02" }, { raw: 300, fmt: "300", longFmt: "300" })).toBe("344.02 x 300");
    expect(yBidAsk({ raw: 569.72, fmt: "569.72" }, { raw: 4000, fmt: "4k", longFmt: "4,000" })).toBe("569.72 x 4,000");
    expect(yBidAsk({ raw: 1.1166, fmt: "1.1166" }, { raw: 0, fmt: null, longFmt: "0" })).toBe("1.1166");
    expect(yBidAsk({ raw: 1.1166, fmt: "1.1166" }, undefined)).toBe("1.1166");
  });

  it("is null without a price", () => {
    expect(yBidAsk({}, {})).toBeNull();
    expect(yBidAsk({ raw: 0, fmt: "0.00" }, { raw: 100 })).toBeNull();
    expect(yBidAsk(undefined, undefined)).toBeNull();
  });
});

describe("yCap", () => {
  it("keeps two decimals where Yahoo rounds", () => {
    expect(yCap({ raw: 5001541320704, fmt: "5T" })).toBe("5.00T");
    expect(yCap({ raw: 796865200128, fmt: "796.87B" })).toBe("796.87B");
    expect(yCap(12)).toBe("12.00");
  });

  it("falls back to fmt, then null", () => {
    expect(yCap({ fmt: "N/A" })).toBe("N/A");
    expect(yCap({})).toBeNull();
    expect(yCap(null)).toBeNull();
  });
});

describe("formatChartTime", () => {
  const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const s = Date.UTC(2026, 10, 5, 17, 50) / 1000;
  const d = new Date(s * 1000);
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  it.each(["1d", "5d", "1mo"])("shows the clock for %s", (range) => {
    expect(formatChartTime(s, range)).toBe(`${day}, ${hm}`);
  });

  it.each(["6mo", "ytd", "1y", "5y", "max", "other"])("shows the year for %s", (range) => {
    expect(formatChartTime(s, range)).toBe(`${day}, ${d.getFullYear()}`);
  });

  it("pads hours and minutes", () => {
    const early = new Date(2026, 0, 2, 3, 4).getTime() / 1000; // local time
    expect(formatChartTime(early, "1d")).toBe("Jan 2, 03:04");
    expect(formatChartTime(early, "1y")).toBe("Jan 2, 2026");
  });

  it("is empty without a time", () => {
    expect(formatChartTime(0, "1d")).toBe("");
    expect(formatChartTime(null, "1d")).toBe("");
    expect(formatChartTime(undefined, "1y")).toBe("");
  });
});

describe("textWidth", () => {
  it("estimates by character class", () => {
    expect(textWidth("AAPL", 12)).toBe(33); // 4 × 0.68 × 12 = 32.64
    expect(textWidth("1,234.50", 12.5)).toBe(53); // 6 × 0.6 + 2 × 0.3 = 4.2 → 52.5
    expect(textWidth("abc", 10)).toBe(17); // 3 × 0.55 = 1.65 → 16.5
    expect(textWidth("·:", 10)).toBe(6);
    expect(textWidth("", 12)).toBe(0);
  });
});

describe("DASH", () => {
  it("is Yahoo's placeholder", () => {
    expect(DASH).toBe("--");
  });
});
