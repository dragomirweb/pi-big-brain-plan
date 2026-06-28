import { describe, expect, it } from "vitest";

import { isModelUnavailable, tail, toError } from "../src/subagent.ts";

describe("tail", () => {
  it("returns empty string for empty input", () => {
    expect(tail("")).toBe("");
  });

  it("returns full string when shorter than limit", () => {
    expect(tail("short message", 50)).toBe("short message");
  });

  it("returns last N chars when longer than limit", () => {
    expect(tail("abcdefghijklmnopqrstuvwxyz", 5)).toBe("vwxyz");
  });

  it("trims whitespace from result", () => {
    expect(tail("\n  padded message  \n", 50)).toBe("padded message");
  });

  it("uses default limit of 500", () => {
    const value = `${"a".repeat(100)}${"b".repeat(500)}`;

    expect(tail(value)).toBe("b".repeat(500));
  });
});

describe("toError", () => {
  it("returns same Error if given an Error", () => {
    const err = new Error("already an error");

    expect(toError(err)).toBe(err);
  });

  it("wraps a string in an Error", () => {
    const err = toError("string failure");

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("string failure");
  });

  it("wraps other types in Error via String()", () => {
    expect(toError(42).message).toBe("42");
    expect(toError(null).message).toBe("null");
    expect(toError(undefined).message).toBe("undefined");
    expect(toError({ problem: true }).message).toBe("[object Object]");
  });
});

describe("isModelUnavailable", () => {
  it("returns true for API key errors", () => {
    expect(isModelUnavailable(new Error("no api key configured"))).toBe(true);
    expect(isModelUnavailable(new Error("missing api key"))).toBe(true);
    expect(isModelUnavailable(new Error("invalid api key"))).toBe(true);
  });

  it("returns true for authorization errors", () => {
    expect(isModelUnavailable(new Error("unauthorized"))).toBe(true);
    expect(isModelUnavailable(new Error("authentication failed"))).toBe(true);
  });

  it("returns true for 401 and 403 errors", () => {
    expect(isModelUnavailable(new Error("401"))).toBe(true);
    expect(isModelUnavailable(new Error("403"))).toBe(true);
  });

  it("returns true for unknown, invalid, or unsupported model errors", () => {
    expect(isModelUnavailable(new Error("unknown model"))).toBe(true);
    expect(isModelUnavailable(new Error("invalid model"))).toBe(true);
    expect(isModelUnavailable(new Error("unsupported model"))).toBe(true);
  });

  it("returns true for model not found or unavailable errors", () => {
    expect(isModelUnavailable(new Error("model not found"))).toBe(true);
    expect(isModelUnavailable(new Error("model not available"))).toBe(true);
    expect(isModelUnavailable(new Error("model does not exist"))).toBe(true);
  });

  it("returns true for no models available", () => {
    expect(isModelUnavailable(new Error("no models available"))).toBe(true);
  });

  it("returns true for provider lookup or configuration errors", () => {
    expect(isModelUnavailable(new Error("provider not found"))).toBe(true);
    expect(isModelUnavailable(new Error("provider not configured"))).toBe(true);
  });

  it("returns true for model-unavailable sentinel", () => {
    expect(isModelUnavailable(new Error("model-unavailable"))).toBe(true);
  });

  it("returns false for generic errors", () => {
    expect(isModelUnavailable(new Error("network timeout"))).toBe(false);
  });

  it("returns false for empty message", () => {
    expect(isModelUnavailable(new Error(""))).toBe(false);
  });
});
