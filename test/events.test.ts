import { describe, expect, it } from "vitest";

import { registerPlanEvents } from "../src/events.ts";
import { PERSIST_KEY, PLAN_TOOL, type Plan, REFINE_TOOL, createPlanState } from "../src/state.ts";
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
  it("does not append plan addendum when plan mode is off", async () => {
    const { pi, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanEvents(pi, state);

    const result = await dispatch("before_agent_start", {
      systemPrompt: "base prompt",
      prompt: "user prompt",
      images: [],
      systemPromptOptions: {},
    });

    expect(result).toBeUndefined();
  });

  it("appends plan addendum to system prompt when plan mode is on", async () => {
    const { pi, dispatch } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.planActive = true;
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
    state.planActive = true;
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
      customType: PERSIST_KEY,
      data: { v: 1, plan: savedPlan, config: savedConfig },
    });

    await dispatch("session_start", { reason: "startup" });

    expect(state.currentPlan).toBe(savedPlan);
    expect(state.config.plannerModel).toBe("google/gemini-2");
    expect(state.config.fallbackModels).toEqual(["openai/gpt-4o"]);
    expect(state.planActive).toBe(false);
  });

  it("restores active plan mode from v2 session entries and activates tools", async () => {
    const { pi, entries, dispatch, activeTools } = makeMockPi({ activeTools: ["read"] });
    const state = createPlanState(baseConfig);
    registerPlanEvents(pi, state);

    const savedConfig = {
      plannerModel: "google/gemini-2",
      fallbackModels: ["openai/gpt-4o"],
    };
    entries.push({
      type: "custom",
      customType: PERSIST_KEY,
      data: { v: 2, config: savedConfig, planActive: true },
    });

    await dispatch("session_start", { reason: "startup" });

    expect(state.currentPlan).toBeNull();
    expect(state.config.plannerModel).toBe("google/gemini-2");
    expect(state.config.fallbackModels).toEqual(["openai/gpt-4o"]);
    expect(state.planActive).toBe(true);
    expect(activeTools).toEqual(["read", PLAN_TOOL, REFINE_TOOL]);
  });

  it("keeps existing state when no saved state exists and deactivates plan tools", async () => {
    const { pi, dispatch, activeTools } = makeMockPi({
      activeTools: ["read", PLAN_TOOL, REFINE_TOOL],
    });
    const state = createPlanState(baseConfig);
    const plan = makePlan();
    state.currentPlan = plan;
    registerPlanEvents(pi, state);

    await dispatch("session_start", { reason: "startup" });

    expect(state.currentPlan).toBe(plan);
    expect(state.config).toEqual(baseConfig);
    expect(state.planActive).toBe(false);
    expect(activeTools).toEqual(["read"]);
  });
});
