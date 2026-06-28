import { describe, expect, it } from "vitest";

import { registerPlanEvents } from "../src/events.ts";
import { type Plan, createPlanState } from "../src/state.ts";
import { makeMockPi } from "./helpers/mock-pi.ts";

const baseConfig = { plannerModel: "anthropic/claude-sonnet-4", fallbackModels: [] };

function makePlan(): Plan {
  return {
    id: "plan-test",
    title: "Test Plan",
    problemStatement: "Build a thing",
    summary: "We build the thing",
    slices: [
      {
        id: "s1",
        title: "Slice 1",
        goal: "First slice",
        acceptanceCriteria: ["It works"],
        tasks: [{ description: "Do stuff", files: ["src/foo.ts"], details: "Details" }],
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

describe("before_agent_start", () => {
  it("appends plan addendum to system prompt", async () => {
    const { pi, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanEvents(pi, state);

    const result = await dispatch("before_agent_start", {
      systemPrompt: "base prompt",
      prompt: "user prompt",
      images: [],
      systemPromptOptions: {},
    });

    expect(result).toHaveProperty("systemPrompt");
    expect((result as { systemPrompt: string }).systemPrompt).toContain("base prompt");
    expect((result as { systemPrompt: string }).systemPrompt).toContain("No active plan");
  });

  it("includes plan info when a plan exists", async () => {
    const { pi, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanEvents(pi, state);

    const result = await dispatch("before_agent_start", {
      systemPrompt: "base prompt",
      prompt: "user prompt",
      images: [],
      systemPromptOptions: {},
    });

    const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
    expect(systemPrompt).toContain("base prompt");
    expect(systemPrompt).toContain('Current plan: "Test Plan"');
    expect(systemPrompt).toContain("1 slices");
  });
});

describe("session_start", () => {
  it("restores plan state from session entries", async () => {
    const { pi, entries, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanEvents(pi, state);

    const savedPlan = makePlan();
    const savedConfig = {
      plannerModel: "google/gemini-2",
      fallbackModels: ["openai/gpt-4o"],
    };
    entries.push({
      type: "custom",
      customType: "plan-v1",
      data: { v: 1, plan: savedPlan, config: savedConfig },
    });

    await dispatch("session_start", { reason: "startup" });

    expect(state.currentPlan).toBe(savedPlan);
    expect(state.config.plannerModel).toBe("google/gemini-2");
    expect(state.config.fallbackModels).toEqual(["openai/gpt-4o"]);
  });

  it("does nothing when no saved state exists", async () => {
    const { pi, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    const plan = makePlan();
    state.currentPlan = plan;
    registerPlanEvents(pi, state);

    await dispatch("session_start", { reason: "startup" });

    expect(state.currentPlan).toBe(plan);
    expect(state.config).toEqual(baseConfig);
  });
});
