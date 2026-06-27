import { describe, expect, it } from "vitest";

import { createPlanState, generatePlanId, generateSliceId } from "../src/state.ts";

describe("plan state", () => {
  it("createPlanState initializes with null plan", () => {
    const state = createPlanState({
      plannerModel: "anthropic/claude-sonnet-4",
      fallbackModels: [],
    });
    expect(state.currentPlan).toBeNull();
    expect(state.config.plannerModel).toBe("anthropic/claude-sonnet-4");
  });

  it("generatePlanId produces prefixed IDs", () => {
    const id = generatePlanId();
    expect(id).toMatch(/^plan-[a-z0-9]+$/);
  });

  it("generateSliceId produces sequential IDs", () => {
    expect(generateSliceId(0)).toBe("s1");
    expect(generateSliceId(4)).toBe("s5");
  });
});
