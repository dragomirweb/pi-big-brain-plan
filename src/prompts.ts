import { Type } from "typebox";

import type { Plan, PlanState } from "./state.ts";

// ---------- Tool parameter schemas ----------

export const PlanParams = Type.Object({
  problem: Type.String({
    description: "The problem statement, idea, or feature to plan. Be as detailed as possible.",
  }),
  context: Type.Optional(
    Type.String({
      description:
        "Additional context: constraints, prior art, codebase paths to inspect, tech stack, etc.",
    }),
  ),
  feedback: Type.Optional(
    Type.String({
      description:
        "Feedback on the current plan to incorporate in the next iteration. Use when refining an existing plan.",
    }),
  ),
  reads: Type.Optional(
    Type.Array(Type.String(), {
      description: "Paths the planner should read for codebase context before planning.",
    }),
  ),
});

export const RefineParams = Type.Object({
  sliceId: Type.String({
    description: "The ID of the slice to refine (e.g. 's1', 's2').",
  }),
  instructions: Type.Optional(
    Type.String({
      description: "Specific instructions for refinement: what to drill into, concerns, questions.",
    }),
  ),
  reads: Type.Optional(
    Type.Array(Type.String(), {
      description: "Paths the reasoner should read for additional context.",
    }),
  ),
});

// ---------- Tool descriptions ----------

export function planToolDescription(): string {
  return `Create or iterate on an implementation spec for a problem or idea. Spawns a
planning subagent that can inspect the codebase (read-only) and produces a
structured spec broken into ordered vertical slices.

Provide:
- \`problem\`: the problem statement, idea, or feature to plan.
- \`context\`: (optional) constraints, prior art, tech stack, codebase paths.
- \`feedback\`: (optional) feedback on the current plan to refine it. When
  provided, the planner updates the existing plan rather than starting fresh.
- \`reads\`: (optional) paths the planner should read first for context.

Each call produces or refines a structured implementation spec with:
- Ordered vertical slices (each independently implementable)
- Acceptance criteria per slice
- Task breakdown with affected files
- Dependencies between slices
- Assumptions and open questions

Call repeatedly with \`feedback\` to iterate until the spec is solid. Then use
\`/plan export\` to render the final implementation spec as markdown.`;
}

export function refineToolDescription(): string {
  return `Deep-dive into a single slice of the current implementation spec. Spawns a
reasoning subagent that analyzes the slice in detail, considering the codebase,
and returns a more thorough breakdown.

Provide:
- \`sliceId\`: the ID of the slice to refine (e.g. 's1').
- \`instructions\`: (optional) what to focus on — risks, alternatives, unknowns.
- \`reads\`: (optional) extra paths to read for context.

The reasoner may:
- Expand the task breakdown with more granular steps
- Identify risks and alternatives
- Suggest splitting the slice into sub-slices
- Add or update acceptance criteria
- Flag technical concerns

Use after \`big_brain_plan\` to drill into slices that need more detail.`;
}

// ---------- Planner subagent system prompt ----------

export function plannerSystemPrompt(
  existingPlan: Plan | null,
  feedback: string | undefined,
): string {
  const existingPlanSection = existingPlan
    ? `\n\n## Existing plan to refine\n\`\`\`json\n${JSON.stringify(existingPlan, null, 2)}\n\`\`\`\n\nThe user has provided feedback on this plan. Incorporate the feedback and produce an updated plan. Preserve slice IDs where slices remain conceptually the same. You may add, remove, reorder, or merge slices as needed.`
    : "";

  const feedbackSection = feedback ? `\n\n## User feedback to incorporate\n${feedback}` : "";

  return `You are an expert SOFTWARE ARCHITECT and IMPLEMENTATION PLANNER. Your job is to
take a problem statement or idea and produce a structured implementation spec
broken into ordered VERTICAL SLICES.

## Principles

1. **Vertical slices, not horizontal layers.** Each slice delivers observable,
   testable value end-to-end. Avoid "set up the database" then "build the API"
   then "build the UI" — instead, slice by user-facing behavior.
2. **Order by dependency and risk.** High-risk or foundational slices go first.
   A later slice can depend on an earlier one, never the reverse.
3. **Each slice is independently implementable.** A developer (or agent) should
   be able to pick up a slice and complete it with the information provided.
4. **Right-size slices.** Each slice should be roughly 1-4 hours of work. If a
   slice is larger, split it. If it is trivial, merge with an adjacent slice.
5. **Ground in reality.** Inspect the codebase to understand existing patterns,
   tech stack, file structure, and conventions. Do not invent abstractions that
   conflict with what is already there.
6. **Be concrete.** List specific files to create/modify, specific functions,
   specific tests. Vague plans are useless.

## Process

1. Read any context files mentioned in the task.
2. Explore the codebase structure (ls, find, grep) to understand patterns.
3. Analyze the problem from multiple angles.
4. Produce the implementation spec.

## Output format

You MUST end your response with a JSON block wrapped in \\\`\\\`\\\`json ... \\\`\\\`\\\` fences.
The JSON must conform to this schema:

\\\`\\\`\\\`
{
  "title": "Short descriptive title for the spec",
  "summary": "2-3 sentence executive summary of the approach",
  "slices": [
    {
      "id": "s1",
      "title": "Slice title",
      "goal": "What this slice achieves (1-2 sentences)",
      "acceptanceCriteria": [
        "Given X, when Y, then Z",
        "..."
      ],
      "tasks": [
        {
          "description": "What to do",
          "files": ["src/foo.ts", "test/foo.test.ts"],
          "details": "Implementation notes, patterns to follow, gotchas"
        }
      ],
      "dependencies": [],
      "order": 1,
      "notes": "Optional notes, risks, alternatives"
    }
  ],
  "assumptions": ["Things assumed to be true"],
  "openQuestions": ["Things that need clarification"]
}
\\\`\\\`\\\`

Slice IDs are "s1", "s2", etc. Dependencies reference other slice IDs.
Order is 1-indexed and reflects implementation sequence.${existingPlanSection}${feedbackSection}`;
}

// ---------- Refiner subagent system prompt ----------

export function refinerSystemPrompt(plan: Plan, sliceId: string): string {
  const slice = plan.slices.find((s) => s.id === sliceId);
  if (!slice) {
    return `No slice found with ID "${sliceId}". Available slices: ${plan.slices.map((s) => s.id).join(", ")}`;
  }

  return `You are an expert SOFTWARE ARCHITECT doing a DEEP DIVE on a single implementation
slice. You have the full plan for context, but your job is to thoroughly analyze
and refine ONE specific slice.

## Full plan context
\\\`\\\`\\\`json
${JSON.stringify(plan, null, 2)}
\\\`\\\`\\\`

## Slice to refine: ${slice.id} — ${slice.title}
\\\`\\\`\\\`json
${JSON.stringify(slice, null, 2)}
\\\`\\\`\\\`

## Your job

1. Read any context files mentioned.
2. Inspect the codebase for relevant patterns, existing code, and constraints.
3. Analyze this slice deeply:
   - Are the tasks complete and correctly ordered?
   - Are there edge cases or error paths missing?
   - Are the acceptance criteria testable and sufficient?
   - Are there risks or unknowns?
   - Should this slice be split into sub-slices?
   - Are there better implementation approaches?
4. Produce an updated, more detailed version of the slice.

## Output format

End your response with a JSON block:

\\\`\\\`\\\`json
{
  "sliceId": "${slice.id}",
  "title": "Updated title (or same)",
  "goal": "Updated goal (or same)",
  "acceptanceCriteria": ["Updated criteria"],
  "tasks": [
    {
      "description": "More granular task",
      "files": ["specific/files.ts"],
      "details": "Detailed implementation notes"
    }
  ],
  "risks": ["Identified risks"],
  "alternatives": ["Alternative approaches considered"],
  "suggestedSubSlices": [],
  "notes": "Updated notes"
}
\\\`\\\`\\\`

If the slice should be split, populate suggestedSubSlices with the same
structure as the tasks array. Otherwise leave it as an empty array.`;
}

// ---------- Prompt addendum (injected into main agent system prompt) ----------

export function planAddendum(state: PlanState): string {
  const planStatus = state.currentPlan
    ? `\n\nCurrent plan: "${state.currentPlan.title}" (${state.currentPlan.slices.length} slices, status: ${state.currentPlan.status}, ${state.currentPlan.iterations} iterations).`
    : "\n\nNo active plan. Use `big_brain_plan` to start planning.";

  return `## Implementation Spec Planner available

You have access to \`big_brain_plan\` and \`refine_slice\` tools for creating
structured implementation specs. When the user describes a problem, feature,
or idea that needs planning:

1. Call \`big_brain_plan\` with the problem statement to generate an initial spec.
2. Review the slices with the user.
3. Call \`big_brain_plan\` again with \`feedback\` to iterate.
4. Use \`refine_slice\` to deep-dive into specific slices.
5. Use \`/plan export\` to render the final spec.
${planStatus}`;
}

// ---------- Command UI messages ----------

export function planUsage(): string {
  return "Usage: /plan status | export | reset | model <model-id> | fallback <id[,id]|none> | slice <id> | help";
}

export function planStatus(state: PlanState): string {
  if (!state.currentPlan) {
    return "No active plan. Use `big_brain_plan` tool or describe a problem to start planning.";
  }
  const plan = state.currentPlan;
  const sliceList = plan.slices.map((s) => `  ${s.id}. [${s.status}] ${s.title}`).join("\n");
  return `Plan: ${plan.title}
Status: ${plan.status} (${plan.iterations} iterations)
Slices (${plan.slices.length}):
${sliceList}${plan.openQuestions.length > 0 ? `\nOpen questions: ${plan.openQuestions.length}` : ""}${plan.assumptions.length > 0 ? `\nAssumptions: ${plan.assumptions.length}` : ""}`;
}

export function planReset(): string {
  return "Plan cleared. Use `big_brain_plan` to start a new plan.";
}

export function planModelSet(state: PlanState): string {
  return `Planner model set: ${state.config.plannerModel}.`;
}

export function unknownModel(value: string): string {
  return `Unknown model "${value}". Use provider/model-id (e.g. anthropic/claude-sonnet-4).`;
}
