import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { loadLatest, persist, planFilePath } from "../src/persistence.ts";
import {
  PERSIST_KEY,
  PLAN_DIR,
  PLAN_EXPORT_FILE,
  PLAN_FILE,
  type Plan,
  type PlanConfig,
  type PlanState,
} from "../src/state.ts";

type SessionManager = Parameters<typeof loadLatest>[0];

type MockEntry = {
  type: string;
  customType?: string;
  data?: unknown;
};

const baseConfig: PlanConfig = {
  plannerModel: "anthropic/claude-sonnet-4",
  fallbackModels: [],
};

function withTempCwd<T>(fn: (cwd: string) => T): T {
  const cwd = mkdtempSync(join(tmpdir(), "pi-big-brain-plan-"));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function makeSessionManager(entries: MockEntry[]): SessionManager {
  return { getEntries: () => entries } as SessionManager;
}

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

function persisted(plannerModel: string) {
  return {
    v: 1 as const,
    plan: null,
    config: { plannerModel, fallbackModels: [] },
  };
}

function entry(data: unknown, customType = PERSIST_KEY, type = "custom"): MockEntry {
  return { type, customType, data };
}

describe("persist", () => {
  it("writes plan JSON and markdown files and appends a lightweight v2 entry", () => {
    withTempCwd((cwd) => {
      const entries: MockEntry[] = [];
      const pi = {
        appendEntry: (customType: string, data: unknown) => {
          entries.push({ type: "custom", customType, data });
        },
      } as Parameters<typeof persist>[0];
      const plan = makePlan();
      const state: PlanState = { currentPlan: plan, config: baseConfig, planActive: true };

      persist(pi, state, cwd);

      const jsonPath = join(cwd, CONFIG_DIR_NAME, PLAN_DIR, PLAN_FILE);
      const mdPath = join(cwd, CONFIG_DIR_NAME, PLAN_DIR, PLAN_EXPORT_FILE);
      expect(readFileSync(jsonPath, "utf-8")).toBe(JSON.stringify(plan, null, 2));
      expect(readFileSync(mdPath, "utf-8")).toContain("# Test Plan");
      expect(entries.at(-1)).toEqual({
        type: "custom",
        customType: PERSIST_KEY,
        data: { v: 2, config: baseConfig, planActive: true },
      });
      expect(JSON.stringify(entries.at(-1)?.data)).not.toContain("slices");
    });
  });

  it("removes plan files on reset and still appends a v2 entry", () => {
    withTempCwd((cwd) => {
      const entries: MockEntry[] = [];
      const pi = {
        appendEntry: (customType: string, data: unknown) => {
          entries.push({ type: "custom", customType, data });
        },
      } as Parameters<typeof persist>[0];
      const state: PlanState = { currentPlan: makePlan(), config: baseConfig, planActive: false };

      persist(pi, state, cwd);
      state.currentPlan = null;
      persist(pi, state, cwd);

      expect(existsSync(join(cwd, CONFIG_DIR_NAME, PLAN_DIR, PLAN_FILE))).toBe(false);
      expect(existsSync(join(cwd, CONFIG_DIR_NAME, PLAN_DIR, PLAN_EXPORT_FILE))).toBe(false);
      expect(entries.at(-1)?.data).toEqual({ v: 2, config: baseConfig, planActive: false });
    });
  });
});

describe("loadLatest", () => {
  it("returns null when entries array is empty", () => {
    withTempCwd((cwd) => {
      expect(loadLatest(makeSessionManager([]), cwd)).toBeNull();
    });
  });

  it("returns null when no entries match plan-v1 customType", () => {
    withTempCwd((cwd) => {
      const entries = [entry(persisted("first"), "other-custom-type")];

      expect(loadLatest(makeSessionManager(entries), cwd)).toBeNull();
    });
  });

  it("returns the latest matching v1 entry", () => {
    withTempCwd((cwd) => {
      const first = persisted("first");
      const latest = persisted("latest");
      const entries = [entry(first), entry({ v: 1 }, "other-custom-type"), entry(latest)];

      expect(loadLatest(makeSessionManager(entries), cwd)).toEqual({
        plan: latest.plan,
        config: latest.config,
        planActive: false,
      });
    });
  });

  it("loads a v2 entry from disk", () => {
    withTempCwd((cwd) => {
      const plan = makePlan();
      const config = { plannerModel: "google/gemini-2", fallbackModels: ["openai/gpt-4o"] };
      const planDir = join(cwd, CONFIG_DIR_NAME, PLAN_DIR);
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, PLAN_FILE), JSON.stringify(plan));

      expect(loadLatest(makeSessionManager([entry({ v: 2, config })]), cwd)).toEqual({
        plan,
        config,
        planActive: false,
      });
    });
  });

  it("returns a null plan for v2 when the plan file is missing", () => {
    withTempCwd((cwd) => {
      const config = { plannerModel: "google/gemini-2", fallbackModels: [] };

      expect(
        loadLatest(makeSessionManager([entry({ v: 2, config, planActive: true })]), cwd),
      ).toEqual({
        plan: null,
        config,
        planActive: true,
      });
    });
  });

  it("ignores entries with unsupported versions", () => {
    withTempCwd((cwd) => {
      const valid = persisted("valid");
      const entries = [entry(valid), entry({ v: 3, plan: null, config: valid.config })];

      expect(loadLatest(makeSessionManager(entries), cwd)).toEqual({
        plan: valid.plan,
        config: valid.config,
        planActive: false,
      });
    });
  });

  it("ignores entries with wrong type", () => {
    withTempCwd((cwd) => {
      const valid = persisted("valid");
      const entries = [entry(valid), entry(persisted("wrong-type"), PERSIST_KEY, "message")];

      expect(loadLatest(makeSessionManager(entries), cwd)).toEqual({
        plan: valid.plan,
        config: valid.config,
        planActive: false,
      });
    });
  });

  it("ignores entries with wrong customType", () => {
    withTempCwd((cwd) => {
      const valid = persisted("valid");
      const entries = [entry(valid), entry(persisted("wrong-custom-type"), "other-custom-type")];

      expect(loadLatest(makeSessionManager(entries), cwd)).toEqual({
        plan: valid.plan,
        config: valid.config,
        planActive: false,
      });
    });
  });
});

describe("planFilePath", () => {
  it("returns a relative plan file path", () => {
    withTempCwd((cwd) => {
      expect(planFilePath(cwd)).toBe(`${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_FILE}`);
    });
  });
});
