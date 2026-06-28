import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";

import { persist, planFilePath } from "./persistence.ts";
import { PlanParams, planToolDescription, plannerSystemPrompt } from "./prompts.ts";
import {
  PLAN_TOOL,
  type Plan,
  type PlanSlice,
  type PlanState,
  extractJsonBlock,
  generatePlanId,
  toTask,
} from "./state.ts";
import { type PlannerDetails, isModelUnavailable, runSubagent, toError } from "./subagent.ts";

type PlanParamsT = Static<typeof PlanParams>;

export function registerPlanTool(pi: ExtensionAPI, state: PlanState): void {
  pi.registerTool({
    name: PLAN_TOOL,
    label: "Implementation spec planner",
    description: planToolDescription(),
    parameters: PlanParams,
    promptSnippet:
      "big_brain_plan — create or iterate on an implementation spec, breaking a problem into ordered vertical slices.",
    executionMode: "sequential",
    execute: async (
      _toolCallId: string,
      params: PlanParamsT,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<PlannerDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<PlannerDetails>> => {
      const models = [state.config.plannerModel, ...state.config.fallbackModels].filter(Boolean);
      let lastErr: Error | null = null;

      const relPath = planFilePath(ctx.cwd);
      const task = assembleTask(params, state.currentPlan, relPath);

      for (const model of models) {
        try {
          const result = await runSubagent(
            model,
            plannerSystemPrompt(!!state.currentPlan && !!params.feedback, params.feedback, relPath),
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

          const parsed = extractPlanJson(text);
          if (parsed) {
            const plan = toPlan(parsed, params.problem, state.currentPlan);
            state.currentPlan = plan;
            persist(pi, state, ctx.cwd);
          }

          return result;
        } catch (err) {
          lastErr = toError(err);
          if (!isModelUnavailable(lastErr)) throw lastErr;
        }
      }

      throw new Error(
        `big_brain_plan failed for all models [${models.join(", ")}]: ${lastErr?.message ?? "unknown"}`,
      );
    },
  });
}

function assembleTask(
  params: PlanParamsT,
  existingPlan: Plan | null,
  planFileRelPath: string,
): string {
  let task = `Plan an implementation for:\n\n${params.problem}`;

  if (params.context) task += `\n\n## Context\n${params.context}`;

  if (params.feedback && existingPlan) {
    task += `\n\n## Feedback on current plan\n${params.feedback}`;
  }

  // Prepend plan file to reads when refining
  const reads = [
    ...(existingPlan && params.feedback ? [planFileRelPath] : []),
    ...(params.reads ?? []),
  ];
  if (reads.length) {
    task += `\n\n## Read these files first for context\n${reads.map((path) => `- ${path}`).join("\n")}`;
  }

  return task;
}

export function extractPlanJson(text: string): Record<string, unknown> | null {
  return extractJsonBlock(text, "slices");
}

function toPlan(
  raw: Record<string, unknown>,
  problemStatement: string,
  existing: Plan | null,
): Plan {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? generatePlanId(),
    title: typeof raw.title === "string" ? raw.title : "Untitled Plan",
    problemStatement,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    slices: Array.isArray(raw.slices) ? raw.slices.map(toSlice) : [],
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((a): a is string => typeof a === "string")
      : [],
    openQuestions: Array.isArray(raw.openQuestions)
      ? raw.openQuestions.filter((q): q is string => typeof q === "string")
      : [],
    status: existing ? "refining" : "drafting",
    iterations: (existing?.iterations ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function toSlice(raw: unknown): PlanSlice {
  if (typeof raw !== "object" || raw === null) {
    return emptySlice("??");
  }
  const obj = raw as Record<string, unknown>;
  return {
    id: typeof obj.id === "string" ? obj.id : "??",
    title: typeof obj.title === "string" ? obj.title : "Untitled",
    goal: typeof obj.goal === "string" ? obj.goal : "",
    acceptanceCriteria: Array.isArray(obj.acceptanceCriteria)
      ? obj.acceptanceCriteria.filter((a): a is string => typeof a === "string")
      : [],
    tasks: Array.isArray(obj.tasks) ? obj.tasks.map(toTask) : [],
    dependencies: Array.isArray(obj.dependencies)
      ? obj.dependencies.filter((d): d is string => typeof d === "string")
      : [],
    status: "draft",
    notes: typeof obj.notes === "string" ? obj.notes : "",
    order: typeof obj.order === "number" ? obj.order : 0,
  };
}

function emptySlice(id: string): PlanSlice {
  return {
    id,
    title: "Untitled",
    goal: "",
    acceptanceCriteria: [],
    tasks: [],
    dependencies: [],
    status: "draft",
    notes: "",
    order: 0,
  };
}
