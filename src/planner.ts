import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";

import { persist } from "./persistence.ts";
import { PlanParams, planToolDescription, plannerSystemPrompt } from "./prompts.ts";
import {
  PLAN_TOOL,
  type Plan,
  type PlanSlice,
  type PlanState,
  type PlanTask,
  generatePlanId,
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
    execute: async (
      _toolCallId: string,
      params: PlanParamsT,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<PlannerDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<PlannerDetails>> => {
      const models = [state.config.plannerModel, ...state.config.fallbackModels].filter(Boolean);
      let lastErr: Error | null = null;

      const task = assembleTask(params, state.currentPlan);

      for (const model of models) {
        try {
          const result = await runSubagent(
            model,
            plannerSystemPrompt(params.feedback ? state.currentPlan : null, params.feedback),
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
            persist(pi, state);
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

function assembleTask(params: PlanParamsT, existingPlan: Plan | null): string {
  let task = `Plan an implementation for:\n\n${params.problem}`;

  if (params.context) task += `\n\n## Context\n${params.context}`;

  if (params.feedback && existingPlan) {
    task += `\n\n## Feedback on current plan\n${params.feedback}`;
  }

  if (params.reads?.length) {
    task += `\n\n## Read these files first for context\n${params.reads.map((path) => `- ${path}`).join("\n")}`;
  }

  return task;
}

export function extractPlanJson(text: string): Record<string, unknown> | null {
  const jsonBlocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (jsonBlocks.length === 0) return null;

  const lastBlock = jsonBlocks[jsonBlocks.length - 1][1];
  try {
    const parsed = JSON.parse(lastBlock) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null && "slices" in parsed) {
      return parsed;
    }
  } catch {
    // JSON parse failed
  }

  return null;
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
    status: "drafting",
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

function toTask(raw: unknown): PlanTask {
  if (typeof raw !== "object" || raw === null) {
    return { description: "", files: [], details: "" };
  }
  const obj = raw as Record<string, unknown>;
  return {
    description: typeof obj.description === "string" ? obj.description : "",
    files: Array.isArray(obj.files)
      ? obj.files.filter((f): f is string => typeof f === "string")
      : [],
    details: typeof obj.details === "string" ? obj.details : "",
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
