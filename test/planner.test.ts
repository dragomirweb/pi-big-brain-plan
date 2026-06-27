import { describe, expect, it } from "vitest";

import { extractPlanJson } from "../src/planner.ts";

describe("extractPlanJson", () => {
  it("extracts a valid plan JSON from markdown fences", () => {
    const json = JSON.stringify(
      {
        title: "My Plan",
        summary: "A summary",
        slices: [
          {
            id: "s1",
            title: "First",
            goal: "Do first thing",
            acceptanceCriteria: ["Done"],
            tasks: [],
            dependencies: [],
            order: 1,
            notes: "",
          },
        ],
        assumptions: [],
        openQuestions: [],
      },
      null,
      2,
    );
    const text = `Here is the plan:\n\n\`\`\`json\n${json}\n\`\`\``;

    const result = extractPlanJson(text);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("My Plan");
    expect(result?.slices).toHaveLength(1);
  });

  it("returns null when no JSON block", () => {
    expect(extractPlanJson("No JSON here")).toBeNull();
  });

  it("returns null when JSON lacks slices key", () => {
    const text = `\`\`\`json\n${JSON.stringify({ title: "No slices" })}\n\`\`\``;
    expect(extractPlanJson(text)).toBeNull();
  });

  it("picks the last JSON block when multiple exist", () => {
    const first = JSON.stringify({ title: "First", slices: [] });
    const second = JSON.stringify({ title: "Second", slices: [{ id: "s1" }] });
    const text = `\`\`\`json\n${first}\n\`\`\`\n\nSome text\n\n\`\`\`json\n${second}\n\`\`\``;

    const result = extractPlanJson(text);
    expect(result?.title).toBe("Second");
  });
});
