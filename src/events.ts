import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { resolveConfig } from "./config.ts";
import { loadLatest } from "./persistence.ts";
import * as prompts from "./prompts.ts";
import { PLAN_TOOL, type PlanState, REFINE_TOOL } from "./state.ts";

export function registerPlanEvents(pi: ExtensionAPI, state: PlanState): void {
  pi.on("before_agent_start", (event: BeforeAgentStartEvent) => {
    if (!state.planActive) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${prompts.planAddendum(state)}` };
  });

  pi.on("session_start", (_event: SessionStartEvent, ctx) => {
    const saved = loadLatest(ctx.sessionManager, ctx.cwd);
    if (saved) {
      state.currentPlan = saved.plan;
      state.config = resolveConfig(pi, saved.config);
      state.planActive = saved.planActive;
    }
    // Apply tool activation — deactivate plan tools when plan mode is off.
    applyPlanTools(pi, state.planActive);
  });
}

export function applyPlanTools(pi: ExtensionAPI, active: boolean): void {
  const current = pi.getActiveTools();
  if (active) {
    pi.setActiveTools([...new Set([...current, PLAN_TOOL, REFINE_TOOL])]);
  } else {
    pi.setActiveTools(current.filter((tool) => tool !== PLAN_TOOL && tool !== REFINE_TOOL));
  }
}
