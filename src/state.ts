export const PLAN_TOOL = "big_brain_plan";
export const REFINE_TOOL = "refine_slice";

export const PERSIST_KEY = "plan-v1";
export const PLAN_DIR = "plans";
export const PLAN_FILE = "current.json";
export const PLAN_EXPORT_FILE = "current.md";

export interface PlanTask {
  description: string;
  files: string[];
  details: string;
}

export interface PlanSlice {
  id: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  tasks: PlanTask[];
  dependencies: string[];
  status: "draft" | "refined" | "approved";
  notes: string;
  order: number;
}

export interface Plan {
  id: string;
  title: string;
  problemStatement: string;
  summary: string;
  slices: PlanSlice[];
  assumptions: string[];
  openQuestions: string[];
  status: "drafting" | "refining" | "complete";
  iterations: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanConfig {
  plannerModel: string;
  fallbackModels: string[];
}

export interface PlanState {
  currentPlan: Plan | null;
  config: PlanConfig;
}

export interface PlanPersisted {
  v: 1;
  plan: Plan | null;
  config: PlanConfig;
}

export interface PlanEntryV2 {
  v: 2;
  config: PlanConfig;
}

export interface LoadedPlanState {
  plan: Plan | null;
  config: PlanConfig;
}

export function createPlanState(config: PlanConfig): PlanState {
  return { currentPlan: null, config };
}

export function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}`;
}

export function toTask(raw: unknown): PlanTask {
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

export function extractJsonBlock(
  text: string,
  requiredKey: string,
): Record<string, unknown> | null {
  const jsonBlocks = [...text.matchAll(/```json\s*\n?([\s\S]*?)```/gi)];
  if (jsonBlocks.length === 0) return null;

  const lastBlock = jsonBlocks[jsonBlocks.length - 1][1];
  try {
    const parsed = JSON.parse(lastBlock) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null && requiredKey in parsed) {
      return parsed;
    }
  } catch {
    // JSON parse failed
  }

  return null;
}
