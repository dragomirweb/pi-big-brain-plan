import { describe, expect, it } from "vitest";

import { registerPlanCommand } from "../src/commands.ts";
import { PERSIST_KEY, type Plan, createPlanState } from "../src/state.ts";
import { makeMockPi } from "./helpers/mock-pi.ts";

const baseConfig = {
  plannerModel: "anthropic/claude-sonnet-4",
  fallbackModels: ["openai-codex/gpt-5.5"],
};

function makePlan(overrides?: Partial<Plan>): Plan {
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
        status: "draft" as const,
        notes: "",
        order: 1,
      },
    ],
    assumptions: ["Assumption 1"],
    openQuestions: ["Question 1"],
    status: "drafting" as const,
    iterations: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function getCommand(commands: Map<string, unknown>, name: string) {
  const cmd = commands.get(name);
  if (!cmd) throw new Error(`Command "${name}" not registered`);
  return cmd as { handler: (args: string, ctx: unknown) => Promise<void> };
}

describe("/plan command", () => {
  it("status with no plan shows empty message", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("status", ctx);

    expect(notifications[0].msg).toMatch(/no active plan/i);
  });

  it("status with an active plan shows slice list", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("status", ctx);

    expect(notifications[0].msg).toContain("Test Plan");
    expect(notifications[0].msg).toContain("s1");
  });

  it("reset clears the plan and persists", async () => {
    const { pi, ctx, commands, entries } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("reset", ctx);

    expect(state.currentPlan).toBeNull();
    expect(entries.at(-1)).toMatchObject({ customType: PERSIST_KEY });
  });

  it("export with no plan warns", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("export", ctx);

    expect(notifications[0].type).toBe("warning");
  });

  it("export with a plan renders markdown", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("export", ctx);

    expect(notifications[0].msg).toContain("# Test Plan");
    expect(notifications[0].msg).toContain("Slice s1");
  });

  it("slice shows detail for a valid ID", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("slice s1", ctx);

    expect(notifications[0].msg).toContain("Slice 1");
  });

  it("slice with unknown ID shows not found", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("slice s99", ctx);

    expect(notifications[0].msg).toMatch(/not found/i);
  });

  it("model sets the planner model", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("model anthropic/claude-sonnet-4", ctx);

    expect(state.config.plannerModel).toBe("anthropic/claude-sonnet-4");
    expect(notifications[0].type).toBe("info");
  });

  it("unknown verb shows usage", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("wat", ctx);

    expect(notifications[0].type).toBe("warning");
  });

  it("help shows usage", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("help", ctx);

    expect(notifications[0].msg).toContain("/plan");
  });
});
