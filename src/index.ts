import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPlanCommand } from "./commands.ts";
import { DEFAULT_CONFIG, registerPlanFlags, resolveConfig } from "./config.ts";
import { registerPlanEvents } from "./events.ts";
import { registerPlanTool } from "./planner.ts";
import { registerRefineTool } from "./refiner.ts";
import { createPlanState } from "./state.ts";

export default function piBigBrainPlan(pi: ExtensionAPI): void {
  if (typeof pi.registerTool !== "function" || typeof pi.on !== "function") {
    pi.registerCommand?.("plan", {
      description: "big-brain-plan (unavailable on this host)",
      handler: async (_args: string, ctx) => {
        ctx.ui.notify("big-brain-plan needs registerTool + pi.on; unsupported host.", "error");
      },
    });
    return;
  }

  registerPlanFlags(pi);
  const config = resolveConfig(pi, DEFAULT_CONFIG);
  const state = createPlanState(config);

  registerPlanCommand(pi, state);
  registerPlanEvents(pi, state);
  registerPlanTool(pi, state);
  registerRefineTool(pi, state);
}
