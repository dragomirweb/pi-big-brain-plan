import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { formatSpecMarkdown } from "./spec-formatter.ts";
import {
  type LoadedPlanState,
  PERSIST_KEY,
  PLAN_DIR,
  PLAN_EXPORT_FILE,
  PLAN_FILE,
  type Plan,
  type PlanEntryV2,
  type PlanPersisted,
  type PlanState,
} from "./state.ts";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

export function persist(pi: ExtensionAPI, state: PlanState, cwd: string): void {
  const planDir = join(cwd, CONFIG_DIR_NAME, PLAN_DIR);
  mkdirSync(planDir, { recursive: true });

  const jsonPath = join(planDir, PLAN_FILE);
  const mdPath = join(planDir, PLAN_EXPORT_FILE);

  if (state.currentPlan) {
    writeFileSync(jsonPath, JSON.stringify(state.currentPlan, null, 2));
    writeFileSync(mdPath, formatSpecMarkdown(state.currentPlan));
  } else {
    // Clean up files on reset
    try {
      unlinkSync(jsonPath);
    } catch {
      // ENOENT ok
    }
    try {
      unlinkSync(mdPath);
    } catch {
      // ENOENT ok
    }
  }

  // Lightweight session entry (config only, no plan data)
  const entry: PlanEntryV2 = { v: 2, config: state.config, planActive: state.planActive };
  pi.appendEntry(PERSIST_KEY, entry);
}

export function loadLatest(
  sessionManager: ReadonlySessionManager,
  cwd: string,
): LoadedPlanState | null {
  const entries = sessionManager.getEntries?.() ?? [];

  // Scan backward for latest plan entry
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== PERSIST_KEY) continue;

    const data = entry.data as { v?: unknown };

    // v2: config in session, plan on disk
    if (data?.v === 2) {
      const v2 = data as PlanEntryV2;
      const plan = loadPlanFromDisk(cwd);
      return { plan, config: v2.config, planActive: v2.planActive ?? false };
    }

    // v1: inline plan data (backward compat — auto-migrates on next persist)
    if (data?.v === 1) {
      const v1 = data as PlanPersisted;
      return { plan: v1.plan, config: v1.config, planActive: false };
    }
  }

  return null;
}

function loadPlanFromDisk(cwd: string): Plan | null {
  const jsonPath = join(cwd, CONFIG_DIR_NAME, PLAN_DIR, PLAN_FILE);
  try {
    if (!existsSync(jsonPath)) return null;

    const content = readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && "slices" in parsed) {
      return parsed as unknown as Plan;
    }
    return null;
  } catch {
    return null; // File doesn't exist or is corrupt
  }
}

export function planFilePath(cwd: string): string {
  void cwd;
  return `${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_FILE}`;
}
