# pi-big-brain-plan

Implementation spec planner for Pi: break problems and ideas into ordered vertical slices, iterate on each slice with codebase-aware reasoning, and export structured implementation specs.

## Install

```sh
pi install npm:pi-big-brain-plan
```

Then **restart Pi or run `/reload`**.

Alternatives:

- From git: `pi install git:github.com/dragomirweb/pi-big-brain-plan`
- Local dev: drop the source in `~/.pi/agent/extensions/`, or run `pi -e ./src/index.ts`

> Plain `npm install pi-big-brain-plan` does **not** register the extension with Pi.

**Tested against Pi v0.80.2.**

## Requirements

- Node >= 22.19.0
- The `pi` binary on `PATH` (spawns subagent processes)
- A planner model you can authenticate: default `anthropic/claude-sonnet-4`, fallback `openai-codex/gpt-5.5`

## Usage

### Tools

Two tools are registered for the agent to use:

**`big_brain_plan`** — Create or iterate on an implementation spec.

| Parameter  | Required | Description                                              |
| ---------- | -------- | -------------------------------------------------------- |
| `problem`  | ✅       | The problem statement, idea, or feature to plan          |
| `context`  |          | Additional constraints, tech stack, paths to inspect     |
| `feedback` |          | Feedback on the current plan (triggers refinement mode)  |
| `reads`    |          | Codebase paths the planner should read first             |

**`refine_slice`** — Deep-dive into a single slice.

| Parameter      | Required | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| `sliceId`      | ✅       | The slice ID to refine (e.g. `s1`)               |
| `instructions` |          | What to focus on — risks, alternatives, unknowns |
| `reads`        |          | Extra context paths                              |

### `/plan` command

```text
/plan status              Show the current plan
/plan export              Render the spec as markdown
/plan reset               Clear the current plan
/plan slice <id>          Show one slice in detail
/plan model <model-id>    Set the planner model
/plan fallback <id|none>  Set fallback models
/plan help                Show usage
```

### Workflow

1. Describe your problem or idea to the agent
2. The agent calls `big_brain_plan` → structured spec with vertical slices
3. Review the slices, give feedback
4. Agent calls `big_brain_plan` with `feedback` → refined spec
5. Use `refine_slice` to drill into specific slices
6. `/plan export` → final implementation spec as markdown

## Configuration

- `--plan-model <model>`: primary planner model (default: `anthropic/claude-sonnet-4`)
- `--plan-fallback <model[,model]>`: fallback model list (default: `openai-codex/gpt-5.5`)

## How it works

`big_brain_plan` spawns a child `pi` process with read-only tools (`read,grep,find,ls,bash`) and a specialized planning system prompt. The subagent:

1. Inspects the codebase for existing patterns and structure
2. Analyzes the problem from multiple angles
3. Produces a JSON implementation spec with ordered vertical slices
4. Each slice has: goal, acceptance criteria, task breakdown with files, dependencies

The extension parses the JSON, stores the plan in session state, and makes it available for iteration, refinement, and export.

Plans persist across session restarts via Pi's session storage.

## Works with pi-brain-mode

When used alongside [pi-brain-mode](https://github.com/dragomirweb/pi-brain-mode), the planning slices can feed directly into `delegate_to_coder` calls — plan first, then execute slice by slice.

## Versioning / compatibility

The Pi peer dependency is `"*"`; compatibility is tracked by tested host version. When reporting breakage, include your `pi --version`.
