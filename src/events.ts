import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { resolveConfig } from "./config.ts";
import { loadLatest } from "./persistence.ts";
import * as prompts from "./prompts.ts";
import type { PlanState } from "./state.ts";

export function registerPlanEvents(pi: ExtensionAPI, state: PlanState): void {
  pi.on("before_agent_start", (event: BeforeAgentStartEvent) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${prompts.planAddendum(state)}` };
  });

  pi.on("session_start", (_event: SessionStartEvent, ctx) => {
    const saved = loadLatest(ctx.sessionManager, ctx.cwd);
    if (saved) {
      state.currentPlan = saved.plan;
      state.config = resolveConfig(pi, saved.config);
    }
  });
}
