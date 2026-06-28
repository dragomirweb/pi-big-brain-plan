import { describe, expect, it } from "vitest";

import { createPlanState, extractJsonBlock, generatePlanId, toTask } from "../src/state.ts";

describe("plan state", () => {
  it("createPlanState initializes with null plan", () => {
    const state = createPlanState({
      plannerModel: "anthropic/claude-sonnet-4",
      fallbackModels: [],
    });
    expect(state.currentPlan).toBeNull();
    expect(state.config.plannerModel).toBe("anthropic/claude-sonnet-4");
    expect(state.planActive).toBe(false);
  });

  it("generatePlanId produces prefixed IDs", () => {
    const id = generatePlanId();
    expect(id).toMatch(/^plan-[a-z0-9]+$/);
  });
});

describe("toTask", () => {
  it("returns empty task for non-object input", () => {
    expect(toTask("not an object")).toEqual({ description: "", files: [], details: "" });
  });

  it("extracts description, files, details from valid input", () => {
    expect(
      toTask({
        description: "Update state helpers",
        files: ["src/state.ts", 42, "test/state.test.ts"],
        details: "Move duplicated helpers into state.",
      }),
    ).toEqual({
      description: "Update state helpers",
      files: ["src/state.ts", "test/state.test.ts"],
      details: "Move duplicated helpers into state.",
    });
  });

  it("handles missing fields gracefully", () => {
    expect(toTask({ description: 123, files: "src/state.ts" })).toEqual({
      description: "",
      files: [],
      details: "",
    });
  });
});

describe("extractJsonBlock", () => {
  it("extracts JSON when required key is present", () => {
    const json = JSON.stringify({ title: "Plan", slices: [] });
    const result = extractJsonBlock(`Here is JSON:\n\n\`\`\`json\n${json}\n\`\`\``, "slices");

    expect(result).toEqual({ title: "Plan", slices: [] });
  });

  it("returns null when no JSON block exists", () => {
    expect(extractJsonBlock("No JSON here", "slices")).toBeNull();
  });

  it("returns null when required key is missing", () => {
    const json = JSON.stringify({ title: "No slices" });

    expect(extractJsonBlock(`\`\`\`json\n${json}\n\`\`\``, "slices")).toBeNull();
  });

  it("picks the last JSON block when multiple exist", () => {
    const first = JSON.stringify({ title: "First", slices: [] });
    const second = JSON.stringify({ title: "Second", slices: [{ id: "s1" }] });
    const text = `\`\`\`json\n${first}\n\`\`\`\n\nSome text\n\n\`\`\`json\n${second}\n\`\`\``;

    const result = extractJsonBlock(text, "slices");
    expect(result?.title).toBe("Second");
  });
});
