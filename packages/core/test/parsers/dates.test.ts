import { describe, expect, it } from "vitest";
import {
  boeDateTimeToIso,
  boeDateToIso,
  normalizeCliDateToBoe,
  parseBoeDate,
  parseBoeDateTime,
} from "../../src/parsers/dates";

describe("dates parser", () => {
  it("parses YYYYMMDD", () => {
    const parsed = parseBoeDate("20260211");
    expect(parsed?.toISOString()).toBe("2026-02-11T00:00:00.000Z");
    expect(boeDateToIso("20260211")).toBe("2026-02-11T00:00:00.000Z");
  });

  it("parses YYYYMMDDTHHMMSSZ", () => {
    const parsed = parseBoeDateTime("20260211T105921Z");
    expect(parsed?.toISOString()).toBe("2026-02-11T10:59:21.000Z");
    expect(boeDateTimeToIso("20260211T105921Z")).toBe("2026-02-11T10:59:21.000Z");
  });

  it("normalizes CLI date format", () => {
    expect(normalizeCliDateToBoe("2026-02-11")).toBe("20260211");
  });

  it("throws on invalid date formats", () => {
    expect(() => parseBoeDate("2026-02-11")).toThrow();
    expect(() => parseBoeDateTime("2026-02-11T00:00:00Z")).toThrow();
    expect(() => normalizeCliDateToBoe("11-02-2026")).toThrow();
  });
});
