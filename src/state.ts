export const PLAN_TOOL = "big_brain_plan";
export const REFINE_TOOL = "refine_slice";

export const PERSIST_KEY = "plan-v1";

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

export function createPlanState(config: PlanConfig): PlanState {
  return { currentPlan: null, config };
}

export function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}`;
}

export function generateSliceId(index: number): string {
  return `s${index + 1}`;
}
