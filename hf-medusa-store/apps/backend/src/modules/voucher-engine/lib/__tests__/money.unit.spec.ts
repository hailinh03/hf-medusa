import * as fs from "fs";
import * as path from "path";
import {
  BPS_DENOMINATOR,
  MoneyError,
  assertSafeInt,
  bps,
  clampMin,
  sumInts,
  toInt,
} from "../money";

// SRS INT-01 / Rule 19 — integer-only monetary calculation (SPEC §23.1).
describe("voucher-engine lib/money", () => {
  describe("source hygiene", () => {
    it("never calls parseFloat, Number.parseFloat, or toFixed", () => {
      const source = fs.readFileSync(
        path.join(__dirname, "../money.ts"),
        "utf8",
      );
      expect(source).not.toMatch(/\bparseFloat\s*\(/);
      expect(source).not.toMatch(/\.toFixed\s*\(/);
    });
  });

  describe("toInt", () => {
    it("normalizes a plain integer number", () => {
      expect(toInt(30000, "test")).toBe(30000);
    });

    it("normalizes a numeric string (BigNumberRawValue.value)", () => {
      expect(toInt({ value: "30000" }, "test")).toBe(30000);
    });

    it("normalizes an IBigNumber-shaped object via .numeric", () => {
      expect(toInt({ numeric: 45000 }, "test")).toBe(45000);
    });

    it("normalizes a BigNumberJS-like object via .toNumber()", () => {
      expect(toInt({ toNumber: () => 12000 }, "test")).toBe(12000);
    });

    it("rejects a non-integer monetary value", () => {
      expect(() => toInt(100.5, "test")).toThrow(MoneyError);
    });

    it("rejects a non-finite monetary value", () => {
      expect(() => toInt(Infinity, "test")).toThrow(MoneyError);
      expect(() => toInt(NaN, "test")).toThrow(MoneyError);
    });

    it("rejects an unrecognized value shape", () => {
      expect(() => toInt(undefined, "test")).toThrow(MoneyError);
      expect(() => toInt(null, "test")).toThrow(MoneyError);
      expect(() => toInt({}, "test")).toThrow(MoneyError);
    });

    it("rejects an unsafe integer", () => {
      expect(() => toInt(Number.MAX_SAFE_INTEGER + 10, "test")).toThrow(
        MoneyError,
      );
    });
  });

  describe("assertSafeInt", () => {
    it("passes for a safe integer", () => {
      expect(() => assertSafeInt(1_000_000, "test")).not.toThrow();
    });

    it("throws for an unsafe integer (e.g. 1e20)", () => {
      expect(() => assertSafeInt(1e20, "test")).toThrow(MoneyError);
    });

    it("throws for a non-integer number", () => {
      expect(() => assertSafeInt(1.5, "test")).toThrow(MoneyError);
    });
  });

  describe("bps — basis-point percentage (floor rounding)", () => {
    it("computes 10% (1000 bps) of 3,800,000 -> 380,000 (SPEC §10.4)", () => {
      expect(bps(3_800_000, 1000)).toBe(380_000);
    });

    it("computes 20% (2000 bps) of 2,840,000 -> 568,000 (SPEC §10.5)", () => {
      expect(bps(2_840_000, 2000)).toBe(568_000);
    });

    it("floors a fractional result instead of rounding", () => {
      // 150,000 * 2000 / 10000 = 30,000 exactly; use a case with remainder.
      expect(bps(150_000, 2000)).toBe(30_000);
      expect(bps(100_001, 1)).toBe(Math.floor((100_001 * 1) / BPS_DENOMINATOR));
    });

    it("rejects basisPoints outside 0..10000", () => {
      expect(() => bps(1000, -1)).toThrow(MoneyError);
      expect(() => bps(1000, 10001)).toThrow(MoneyError);
    });

    it("detects overflow before dividing", () => {
      expect(() => bps(Number.MAX_SAFE_INTEGER, 10000)).toThrow(MoneyError);
    });
  });

  describe("clampMin", () => {
    it("returns the value when above the floor", () => {
      expect(clampMin(500)).toBe(500);
    });

    it("clamps a negative value to 0 by default", () => {
      expect(clampMin(-100)).toBe(0);
    });

    it("clamps to a custom floor", () => {
      expect(clampMin(0, 1)).toBe(1);
    });
  });

  describe("sumInts", () => {
    it("sums a list of integers", () => {
      expect(sumInts([100, 200, 300], "test")).toBe(600);
    });

    it("throws when an element is not a safe integer", () => {
      expect(() => sumInts([100, 1.5], "test")).toThrow(MoneyError);
    });

    it("throws on running-total overflow", () => {
      expect(() =>
        sumInts([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], "test"),
      ).toThrow(MoneyError);
    });
  });
});
