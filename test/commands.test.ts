import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { registerPlanCommand } from "../src/commands.ts";
import { PERSIST_KEY, PLAN_TOOL, type Plan, REFINE_TOOL, createPlanState } from "../src/state.ts";
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

async function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "pi-big-brain-plan-"));
  try {
    await fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("/plan command", () => {
  it("provides argument completions for verbs", () => {
    const { pi, commands } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan") as {
      getArgumentCompletions?: (prefix: string) => unknown;
    };
    expect(cmd.getArgumentCompletions).toBeDefined();
    const completions = cmd.getArgumentCompletions?.("st");
    expect(completions).toEqual([{ value: "status", label: "status" }]);
    expect(cmd.getArgumentCompletions?.("o")).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
  });

  it("provides slice id completions when plan exists", () => {
    const { pi, commands } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan") as {
      getArgumentCompletions?: (prefix: string) => unknown;
    };
    const completions = cmd.getArgumentCompletions?.("slice s");
    expect(completions).toEqual([{ value: "slice s1", label: "slice s1" }]);
  });

  it("status with no plan shows empty message", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("status", ctx);

    expect(notifications[0].msg).toContain("Plan mode: OFF");
    expect(notifications[0].msg).toMatch(/no active plan/i);
    expect(notifications[0].msg).toContain("/plan on");
  });

  it("status with an active plan shows slice list", async () => {
    const { pi, ctx, commands, notifications } = makeMockPi();
    const state = createPlanState(baseConfig);
    state.planActive = true;
    state.currentPlan = makePlan();
    registerPlanCommand(pi, state);

    const cmd = getCommand(commands, "plan");
    await cmd.handler("status", ctx);

    expect(notifications[0].msg).toContain("Plan mode: ON");
    expect(notifications[0].msg).toContain("Test Plan");
    expect(notifications[0].msg).toContain("s1");
  });

  it("on activates plan mode tools and persists", async () => {
    await withTempCwd(async (cwd) => {
      const { pi, ctx, commands, entries, notifications, activeTools } = makeMockPi({
        cwd,
        activeTools: ["read", PLAN_TOOL],
      });
      const state = createPlanState(baseConfig);
      registerPlanCommand(pi, state);

      const cmd = getCommand(commands, "plan");
      await cmd.handler("on", ctx);

      expect(state.planActive).toBe(true);
      expect(activeTools).toEqual(["read", PLAN_TOOL, REFINE_TOOL]);
      expect(entries.at(-1)).toMatchObject({
        customType: PERSIST_KEY,
        data: { v: 2, config: baseConfig, planActive: true },
      });
      expect(notifications[0].msg).toContain("Plan mode ON");
    });
  });

  it("off deactivates plan mode tools and persists", async () => {
    await withTempCwd(async (cwd) => {
      const { pi, ctx, commands, entries, notifications, activeTools } = makeMockPi({
        cwd,
        activeTools: ["read", PLAN_TOOL, REFINE_TOOL],
      });
      const state = createPlanState(baseConfig);
      state.planActive = true;
      registerPlanCommand(pi, state);

      const cmd = getCommand(commands, "plan");
      await cmd.handler("off", ctx);

      expect(state.planActive).toBe(false);
      expect(activeTools).toEqual(["read"]);
      expect(entries.at(-1)).toMatchObject({
        customType: PERSIST_KEY,
        data: { v: 2, config: baseConfig, planActive: false },
      });
      expect(notifications[0].msg).toContain("Plan mode OFF");
    });
  });

  it("reset clears the plan and persists", async () => {
    await withTempCwd(async (cwd) => {
      const { pi, ctx, commands, entries } = makeMockPi({ cwd });
      const state = createPlanState(baseConfig);
      state.currentPlan = makePlan();
      registerPlanCommand(pi, state);

      const cmd = getCommand(commands, "plan");
      await cmd.handler("reset", ctx);

      expect(state.currentPlan).toBeNull();
      expect(entries.at(-1)).toMatchObject({ customType: PERSIST_KEY });
    });
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
    expect(notifications[0].msg).toContain("Plan files");
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
    await withTempCwd(async (cwd) => {
      const { pi, ctx, commands, notifications } = makeMockPi({ cwd });
      const state = createPlanState(baseConfig);
      registerPlanCommand(pi, state);

      const cmd = getCommand(commands, "plan");
      await cmd.handler("model anthropic/claude-sonnet-4", ctx);

      expect(state.config.plannerModel).toBe("anthropic/claude-sonnet-4");
      expect(notifications[0].type).toBe("info");
    });
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
