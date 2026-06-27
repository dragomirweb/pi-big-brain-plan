import { describe, expect, it } from "vitest";

import { planAddendum, plannerSystemPrompt, refinerSystemPrompt } from "../src/prompts.ts";
import type { Plan, PlanState } from "../src/state.ts";

const baseConfig = {
  plannerModel: "anthropic/claude-sonnet-4",
  fallbackModels: [],
};

function makePlan(): Plan {
  return {
    id: "plan-test",
    title: "Test",
    problemStatement: "Problem",
    summary: "Summary",
    slices: [
      {
        id: "s1",
        title: "S1",
        goal: "G1",
        acceptanceCriteria: ["AC1"],
        tasks: [{ description: "T1", files: [], details: "" }],
        dependencies: [],
        status: "draft",
        notes: "",
        order: 1,
      },
    ],
    assumptions: [],
    openQuestions: [],
    status: "drafting",
    iterations: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("plannerSystemPrompt", () => {
  it("includes vertical slicing principles", () => {
    const prompt = plannerSystemPrompt(null, undefined);
    expect(prompt).toContain("Vertical slices");
  });

  it("includes existing plan when refining", () => {
    const plan = makePlan();
    const prompt = plannerSystemPrompt(plan, "Make it better");
    expect(prompt).toContain("Existing plan to refine");
    expect(prompt).toContain("Make it better");
  });
});

describe("refinerSystemPrompt", () => {
  it("includes the target slice", () => {
    const prompt = refinerSystemPrompt(makePlan(), "s1");
    expect(prompt).toContain("s1");
    expect(prompt).toContain("DEEP DIVE");
  });

  it("handles missing slice gracefully", () => {
    const prompt = refinerSystemPrompt(makePlan(), "s99");
    expect(prompt).toContain("No slice found");
  });
});

describe("planAddendum", () => {
  it("shows no-plan message when empty", () => {
    const state: PlanState = { currentPlan: null, config: baseConfig };
    const addendum = planAddendum(state);
    expect(addendum).toContain("No active plan");
  });

  it("shows plan info when present", () => {
    const state: PlanState = { currentPlan: makePlan(), config: baseConfig };
    const addendum = planAddendum(state);
    expect(addendum).toContain("Test");
    expect(addendum).toContain("1 slices");
  });
});
