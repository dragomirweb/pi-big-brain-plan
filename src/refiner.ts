import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";

import { persist, planFilePath } from "./persistence.ts";
import { RefineParams, refineToolDescription, refinerSystemPrompt } from "./prompts.ts";
import { type PlanState, REFINE_TOOL, extractJsonBlock, toTask } from "./state.ts";
import { buildBridgeTask, runViaBridge } from "./subagent-bridge.ts";
import { type PlannerDetails, isModelUnavailable, runSubagent, toError } from "./subagent.ts";

type RefineParamsT = Static<typeof RefineParams>;

export function registerRefineTool(pi: ExtensionAPI, state: PlanState): void {
  pi.registerTool({
    name: REFINE_TOOL,
    label: "Refine a plan slice",
    description: refineToolDescription(),
    parameters: RefineParams,
    promptSnippet:
      "refine_slice — deep-dive into one slice of the implementation spec for more detailed analysis.",
    executionMode: "sequential",
    execute: async (
      _toolCallId: string,
      params: RefineParamsT,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<PlannerDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<PlannerDetails>> => {
      if (!state.currentPlan) {
        throw new Error("No active plan. Use `big_brain_plan` first to create one.");
      }

      const slice = state.currentPlan.slices.find((s) => s.id === params.sliceId);
      if (!slice) {
        throw new Error(
          `Slice "${params.sliceId}" not found. Available: ${state.currentPlan.slices.map((s) => s.id).join(", ")}`,
        );
      }

      const relPath = planFilePath(ctx.cwd);
      const result = await runRefinerWithBridge(
        pi,
        state,
        params,
        slice.title,
        relPath,
        signal,
        onUpdate,
        ctx,
      );

      const text =
        result.content?.[0]?.type === "text" ? (result.content[0] as { text: string }).text : "";

      const parsed = extractRefineJson(text);
      if (parsed) {
        applyRefinement(state, params.sliceId, parsed);
        persist(pi, state, ctx.cwd);
      }

      return result;
    },
  });
}

async function runRefinerWithBridge(
  pi: ExtensionAPI,
  state: PlanState,
  params: RefineParamsT,
  sliceTitle: string,
  planFileRelPath: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<PlannerDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<PlannerDetails>> {
  const taskBody = `Deep-dive into slice ${params.sliceId}.${
    params.instructions ? `\n\n## Focus\n${params.instructions}` : ""
  }`;

  const dynamicContext =
    `## Full plan context\nRead the plan at \`${planFileRelPath}\` for full context.\n\n` +
    `## Slice to refine: ${params.sliceId} — ${sliceTitle}\nAfter reading the plan, focus your analysis on this slice.`;

  const reads = [planFileRelPath, ...(params.reads ?? [])];
  const bridgeTask = buildBridgeTask(taskBody, dynamicContext, reads);
  const bridgeResult = await runViaBridge(
    pi,
    ctx,
    "big-brain-refiner",
    bridgeTask,
    signal,
    onUpdate,
  );
  if (bridgeResult) return bridgeResult;

  // Fallback: use our own process spawner
  const fallbackTask = assembleFallbackRefineTask(params, planFileRelPath);
  const models = [state.config.plannerModel, ...state.config.fallbackModels].filter(Boolean);
  let lastErr: Error | null = null;

  for (const model of models) {
    try {
      return await runSubagent(
        model,
        refinerSystemPrompt(params.sliceId, sliceTitle, planFileRelPath),
        fallbackTask,
        "read,grep,find,ls,bash",
        signal,
        onUpdate,
        ctx.cwd,
      );
    } catch (err) {
      lastErr = toError(err);
      if (!isModelUnavailable(lastErr)) throw lastErr;
    }
  }

  throw new Error(
    `refine_slice failed for all models [${models.join(", ")}]: ${lastErr?.message ?? "unknown"}`,
  );
}

function assembleFallbackRefineTask(params: RefineParamsT, planFileRelPath: string): string {
  let task = `Deep-dive into slice ${params.sliceId}.`;

  if (params.instructions) task += `\n\n## Focus\n${params.instructions}`;

  const reads = [planFileRelPath, ...(params.reads ?? [])];
  task += `\n\n## Read these files first\n${reads.map((path) => `- ${path}`).join("\n")}`;

  return task;
}

export function extractRefineJson(text: string): Record<string, unknown> | null {
  return extractJsonBlock(text, "sliceId");
}

function applyRefinement(
  state: PlanState,
  sliceId: string,
  refined: Record<string, unknown>,
): void {
  if (!state.currentPlan) return;

  const index = state.currentPlan.slices.findIndex((s) => s.id === sliceId);
  if (index === -1) return;

  const existing = state.currentPlan.slices[index];

  state.currentPlan.slices[index] = {
    ...existing,
    title: typeof refined.title === "string" ? refined.title : existing.title,
    goal: typeof refined.goal === "string" ? refined.goal : existing.goal,
    acceptanceCriteria: Array.isArray(refined.acceptanceCriteria)
      ? refined.acceptanceCriteria.filter((a): a is string => typeof a === "string")
      : existing.acceptanceCriteria,
    tasks: Array.isArray(refined.tasks) ? refined.tasks.map(toTask) : existing.tasks,
    notes: typeof refined.notes === "string" ? refined.notes : existing.notes,
    status: "refined",
  };

  if (state.currentPlan.status === "drafting") {
    state.currentPlan.status = "refining";
  }

  state.currentPlan.updatedAt = new Date().toISOString();
}
