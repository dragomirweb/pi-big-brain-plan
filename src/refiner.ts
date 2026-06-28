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

      const models = [state.config.plannerModel, ...state.config.fallbackModels].filter(Boolean);
      let lastErr: Error | null = null;

      const relPath = planFilePath(ctx.cwd);
      const task = assembleRefineTask(params, relPath);

      for (const model of models) {
        try {
          const result = await runSubagent(
            model,
            refinerSystemPrompt(params.sliceId, slice.title, relPath),
            task,
            "read,grep,find,ls,bash",
            signal,
            onUpdate,
            ctx.cwd,
          );

          const text =
            result.content?.[0]?.type === "text"
              ? (result.content[0] as { text: string }).text
              : "";

          const parsed = extractRefineJson(text);
          if (parsed) {
            applyRefinement(state, params.sliceId, parsed);
            persist(pi, state, ctx.cwd);
          }

          return result;
        } catch (err) {
          lastErr = toError(err);
          if (!isModelUnavailable(lastErr)) throw lastErr;
        }
      }

      throw new Error(
        `refine_slice failed for all models [${models.join(", ")}]: ${lastErr?.message ?? "unknown"}`,
      );
    },
  });
}

function assembleRefineTask(params: RefineParamsT, planFileRelPath: string): string {
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
