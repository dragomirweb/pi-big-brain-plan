import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { PERSIST_KEY, type PlanPersisted, type PlanState } from "./state.ts";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

export function persist(pi: ExtensionAPI, state: PlanState): void {
  const data: PlanPersisted = { v: 1, plan: state.currentPlan, config: state.config };
  pi.appendEntry(PERSIST_KEY, data);
}

export function loadLatest(sessionManager: ReadonlySessionManager): PlanPersisted | null {
  const entries = sessionManager.getEntries?.() ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { customType?: unknown; data?: { v?: unknown } };
    if (entry?.customType === PERSIST_KEY && entry?.data?.v === 1) {
      return entry.data as PlanPersisted;
    }
  }
  return null;
}
