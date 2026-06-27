import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { PlanConfig } from "./state.ts";

const DEFAULT_PLANNER_MODEL = "anthropic/claude-sonnet-4";
const DEFAULT_FALLBACK_MODELS = ["openai-codex/gpt-5.5"];

export const DEFAULT_CONFIG: PlanConfig = {
  plannerModel: DEFAULT_PLANNER_MODEL,
  fallbackModels: [...DEFAULT_FALLBACK_MODELS],
};

export function registerPlanFlags(pi: ExtensionAPI): void {
  pi.registerFlag("plan-model", {
    type: "string",
    description: "Model id for the planning subagent.",
  });
  pi.registerFlag("plan-fallback", {
    type: "string",
    description: "Comma-separated fallback model ids for the planner.",
  });
}

export function resolveConfig(pi: ExtensionAPI, base: PlanConfig): PlanConfig {
  const modelFlag = pi.getFlag("plan-model");
  const fallbackFlag = pi.getFlag("plan-fallback");

  const fallbackModels =
    typeof fallbackFlag === "string" && fallbackFlag.length > 0
      ? fallbackFlag
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : base.fallbackModels;

  return {
    plannerModel:
      typeof modelFlag === "string" && modelFlag.length > 0
        ? modelFlag
        : base.plannerModel || DEFAULT_PLANNER_MODEL,
    fallbackModels,
  };
}
