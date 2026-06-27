import { describe, expect, it } from "vitest";

import { formatSliceDetail, formatSpecMarkdown } from "../src/spec-formatter.ts";
import type { Plan } from "../src/state.ts";

function makePlan(): Plan {
  return {
    id: "plan-test",
    title: "Test Plan",
    problemStatement: "We need to build X",
    summary: "A plan to build X using Y",
    slices: [
      {
        id: "s1",
        title: "Foundation",
        goal: "Set up the base",
        acceptanceCriteria: ["Base is set up", "Tests pass"],
        tasks: [
          { description: "Create schema", files: ["src/schema.ts"], details: "Use Zod" },
          { description: "Add tests", files: ["test/schema.test.ts"], details: "" },
        ],
        dependencies: [],
        status: "draft",
        notes: "Start here",
        order: 1,
      },
      {
        id: "s2",
        title: "Feature",
        goal: "Add the feature",
        acceptanceCriteria: ["Feature works"],
        tasks: [{ description: "Implement", files: ["src/feature.ts"], details: "" }],
        dependencies: ["s1"],
        status: "draft",
        notes: "",
        order: 2,
      },
    ],
    assumptions: ["We use TypeScript"],
    openQuestions: ["Which database?"],
    status: "drafting",
    iterations: 2,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("formatSpecMarkdown", () => {
  it("produces a markdown document with all sections", () => {
    const md = formatSpecMarkdown(makePlan());

    expect(md).toContain("# Test Plan");
    expect(md).toContain("A plan to build X using Y");
    expect(md).toContain("## Problem Statement");
    expect(md).toContain("We need to build X");
    expect(md).toContain("## Implementation Slices");
    expect(md).toContain("Slice s1: Foundation");
    expect(md).toContain("Slice s2: Feature");
    expect(md).toContain("## Dependency Graph");
    expect(md).toContain("## Assumptions");
    expect(md).toContain("We use TypeScript");
    expect(md).toContain("## Open Questions");
    expect(md).toContain("Which database?");
  });

  it("includes acceptance criteria as checkboxes", () => {
    const md = formatSpecMarkdown(makePlan());
    expect(md).toContain("- [ ] Base is set up");
    expect(md).toContain("- [ ] Tests pass");
  });

  it("includes file paths in tasks", () => {
    const md = formatSpecMarkdown(makePlan());
    expect(md).toContain("`src/schema.ts`");
  });
});

describe("formatSliceDetail", () => {
  it("returns detail for a valid slice", () => {
    const detail = formatSliceDetail(makePlan(), "s1");
    expect(detail).toContain("Foundation");
    expect(detail).toContain("Set up the base");
  });

  it("returns not-found for unknown slice", () => {
    const detail = formatSliceDetail(makePlan(), "s99");
    expect(detail).toMatch(/not found/i);
  });
});
