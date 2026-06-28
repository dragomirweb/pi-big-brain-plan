import { describe, expect, it } from "vitest";

import { planAddendum, plannerSystemPrompt, refinerSystemPrompt } from "../src/prompts.ts";
import type { Plan, PlanState } from "../src/state.ts";

const baseConfig = {
  plannerModel: "anthropic/claude-sonnet-4",
  fallbackModels: [],
};

const planFileRelPath = ".pi/plans/current.json";

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
    const prompt = plannerSystemPrompt(false, undefined, planFileRelPath);
    expect(prompt).toContain("Vertical slices");
  });

  it("references the existing plan file when refining", () => {
    const prompt = plannerSystemPrompt(true, "Make it better", planFileRelPath);
    expect(prompt).toContain("Existing plan to refine");
    expect(prompt).toContain(planFileRelPath);
    expect(prompt).toContain("Read it first");
    expect(prompt).toContain("Make it better");
    expect(prompt).not.toContain("plan-test");
  });
});

describe("refinerSystemPrompt", () => {
  it("includes the target slice and plan file path", () => {
    const prompt = refinerSystemPrompt("s1", "S1", planFileRelPath);
    expect(prompt).toContain("s1");
    expect(prompt).toContain("S1");
    expect(prompt).toContain(planFileRelPath);
    expect(prompt).toContain("DEEP DIVE");
  });
});

describe("planAddendum", () => {
  it("shows no-plan message when empty", () => {
    const state: PlanState = { currentPlan: null, config: baseConfig, planActive: false };
    const addendum = planAddendum(state);
    expect(addendum).toContain("No active plan");
  });

  it("shows plan info when present", () => {
    const state: PlanState = { currentPlan: makePlan(), config: baseConfig, planActive: true };
    const addendum = planAddendum(state);
    expect(addendum).toContain("Test");
    expect(addendum).toContain("1 slices");
    expect(addendum).toContain(planFileRelPath);
  });
});
