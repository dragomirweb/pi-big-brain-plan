import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, resolveConfig } from "../src/config.ts";
import { makeMockPi } from "./helpers/mock-pi.ts";

describe("resolveConfig", () => {
  it("returns default config when no flags are set", () => {
    const { pi } = makeMockPi();

    expect(resolveConfig(pi, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it("overrides plannerModel when plan-model flag is set", () => {
    const { pi } = makeMockPi({ flags: { "plan-model": "google/gemini-2" } });

    const config = resolveConfig(pi, DEFAULT_CONFIG);

    expect(config.plannerModel).toBe("google/gemini-2");
    expect(config.fallbackModels).toEqual(DEFAULT_CONFIG.fallbackModels);
  });

  it("overrides fallbackModels when plan-fallback flag is set", () => {
    const { pi } = makeMockPi({
      flags: { "plan-fallback": "google/gemini-2,openai/gpt-4o" },
    });

    const config = resolveConfig(pi, DEFAULT_CONFIG);

    expect(config.plannerModel).toBe(DEFAULT_CONFIG.plannerModel);
    expect(config.fallbackModels).toEqual(["google/gemini-2", "openai/gpt-4o"]);
  });

  it("uses base config fallbacks when plan-fallback flag is empty string", () => {
    const base = {
      ...DEFAULT_CONFIG,
      fallbackModels: ["base/fallback-model"],
    };
    const { pi } = makeMockPi({ flags: { "plan-fallback": "" } });

    const config = resolveConfig(pi, base);

    expect(config.fallbackModels).toEqual(["base/fallback-model"]);
  });

  it("handles both flags set simultaneously", () => {
    const { pi } = makeMockPi({
      flags: {
        "plan-model": "google/gemini-2",
        "plan-fallback": "openai/gpt-4o,anthropic/claude-3-5-sonnet",
      },
    });

    const config = resolveConfig(pi, DEFAULT_CONFIG);

    expect(config).toEqual({
      plannerModel: "google/gemini-2",
      fallbackModels: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });
  });
});
