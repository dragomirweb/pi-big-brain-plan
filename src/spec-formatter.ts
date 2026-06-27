import type { Plan, PlanSlice } from "./state.ts";

export function formatSpecMarkdown(plan: Plan): string {
  const sections: string[] = [];

  sections.push(`# ${plan.title}`);
  sections.push("");
  sections.push(`> ${plan.summary}`);
  sections.push("");
  sections.push(
    `**Status:** ${plan.status} | **Iterations:** ${plan.iterations} | **Slices:** ${plan.slices.length}`,
  );
  sections.push("");

  sections.push("## Problem Statement");
  sections.push("");
  sections.push(plan.problemStatement);
  sections.push("");

  sections.push("## Implementation Slices");
  sections.push("");

  for (const slice of plan.slices) {
    sections.push(formatSlice(slice));
  }

  const depsSlices = plan.slices.filter((s) => s.dependencies.length > 0);
  if (depsSlices.length > 0) {
    sections.push("## Dependency Graph");
    sections.push("");
    for (const slice of depsSlices) {
      sections.push(
        `- **${slice.id}** (${slice.title}) → depends on: ${slice.dependencies.join(", ")}`,
      );
    }
    sections.push("");
  }

  if (plan.assumptions.length > 0) {
    sections.push("## Assumptions");
    sections.push("");
    for (const assumption of plan.assumptions) {
      sections.push(`- ${assumption}`);
    }
    sections.push("");
  }

  if (plan.openQuestions.length > 0) {
    sections.push("## Open Questions");
    sections.push("");
    for (const question of plan.openQuestions) {
      sections.push(`- ${question}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

function formatSlice(slice: PlanSlice): string {
  const lines: string[] = [];

  lines.push(`### Slice ${slice.id}: ${slice.title}`);
  lines.push("");
  lines.push(`**Goal:** ${slice.goal}`);
  lines.push(`**Status:** ${slice.status}`);
  if (slice.dependencies.length > 0) {
    lines.push(`**Depends on:** ${slice.dependencies.join(", ")}`);
  }
  lines.push("");

  lines.push("**Acceptance Criteria:**");
  lines.push("");
  for (const criterion of slice.acceptanceCriteria) {
    lines.push(`- [ ] ${criterion}`);
  }
  lines.push("");

  lines.push("**Tasks:**");
  lines.push("");
  for (let i = 0; i < slice.tasks.length; i++) {
    const task = slice.tasks[i];
    lines.push(`${i + 1}. ${task.description}`);
    if (task.files.length > 0) {
      lines.push(`   Files: \`${task.files.join("`, `")}\``);
    }
    if (task.details) {
      lines.push(`   ${task.details}`);
    }
  }
  lines.push("");

  if (slice.notes) {
    lines.push(`> **Notes:** ${slice.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSliceDetail(plan: Plan, sliceId: string): string {
  const slice = plan.slices.find((s) => s.id === sliceId);
  if (!slice) {
    return `Slice "${sliceId}" not found. Available: ${plan.slices.map((s) => s.id).join(", ")}`;
  }
  return formatSlice(slice);
}
