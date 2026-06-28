import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { applyPlanTools } from "./events.ts";
import { persist } from "./persistence.ts";
import * as msg from "./prompts.ts";
import { formatSliceDetail, formatSpecMarkdown } from "./spec-formatter.ts";
import {
  PLAN_DIR,
  PLAN_EXPORT_FILE,
  PLAN_FILE,
  PLAN_TOOL,
  type PlanState,
  REFINE_TOOL,
} from "./state.ts";

type ModelRegistry = ExtensionContext["modelRegistry"];
type Model = NonNullable<ExtensionContext["model"]>;

function canonicalModelId(model: Model): string {
  return `${model.provider}/${model.id}`;
}

function resolveModel(registry: ModelRegistry, idStr: string): Model | undefined {
  const trimmed = idStr.trim();
  if (trimmed === "") return undefined;

  if (trimmed.includes("/")) {
    const slashIndex = trimmed.indexOf("/");
    const provider = trimmed.slice(0, slashIndex);
    const modelId = trimmed.slice(slashIndex + 1);
    const found = registry.find(provider, modelId);
    if (found) return found;
  }

  return registry
    .getAll()
    .find((model) => canonicalModelId(model) === trimmed || model.id === trimmed);
}

export function registerPlanCommand(pi: ExtensionAPI, state: PlanState): void {
  pi.registerCommand("plan", {
    description:
      "Implementation Spec Planner: /plan (settings menu) | on | off | status | export | reset | help",
    getArgumentCompletions: (prefix: string) => {
      const verbs = [
        "on",
        "off",
        "settings",
        "status",
        "export",
        "reset",
        "slice",
        "model",
        "fallback",
        "help",
      ];
      const trimmed = prefix.trim();

      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx !== -1) {
        const verb = trimmed.slice(0, spaceIdx).toLowerCase();
        const rest = trimmed.slice(spaceIdx + 1);
        if (verb === "slice" && state.currentPlan) {
          return state.currentPlan.slices
            .map((s) => s.id)
            .filter((id) => id.startsWith(rest))
            .map((id) => ({ value: `slice ${id}`, label: `slice ${id}` }));
        }
        return null;
      }

      return verbs.filter((v) => v.startsWith(trimmed)).map((v) => ({ value: v, label: v }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const text = (args ?? "").trim();
      const spaceIndex = text.search(/\s/);
      const verb = (spaceIndex === -1 ? text : text.slice(0, spaceIndex)).toLowerCase();
      const value = spaceIndex === -1 ? "" : text.slice(spaceIndex).trim();

      if (verb === "on") {
        state.planActive = true;
        applyPlanTools(pi, true);
        persist(pi, state, ctx.cwd);
        ctx.ui.notify(
          `🧠 Plan mode ON — ${PLAN_TOOL} and ${REFINE_TOOL} tools are now active.`,
          "info",
        );
        return;
      }

      if (verb === "off") {
        state.planActive = false;
        applyPlanTools(pi, false);
        persist(pi, state, ctx.cwd);
        ctx.ui.notify("Plan mode OFF — planning tools deactivated.", "info");
        return;
      }

      if (verb === "" || verb === "settings") {
        await showPlanSettings(pi, state, ctx);
        return;
      }

      if (verb === "status") {
        const modeLabel = state.planActive ? "🧠 Plan mode: ON" : "Plan mode: OFF";
        ctx.ui.notify(`${modeLabel}\n${msg.planStatus(state)}`, "info");
        return;
      }

      if (verb === "export") {
        if (!state.currentPlan) {
          ctx.ui.notify("No active plan to export.", "warning");
          return;
        }
        const markdown = formatSpecMarkdown(state.currentPlan);
        ctx.ui.notify(
          `${markdown}\n\n---\n📄 Plan files: \`${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_FILE}\` and \`${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_EXPORT_FILE}\``,
          "info",
        );
        return;
      }

      if (verb === "reset") {
        state.currentPlan = null;
        persist(pi, state, ctx.cwd);
        ctx.ui.notify(msg.planReset(), "info");
        return;
      }

      if (verb === "slice") {
        if (!state.currentPlan) {
          ctx.ui.notify("No active plan.", "warning");
          return;
        }
        if (value === "") {
          ctx.ui.notify("Usage: /plan slice <id> (e.g. /plan slice s1)", "warning");
          return;
        }
        const detail = formatSliceDetail(state.currentPlan, value);
        ctx.ui.notify(detail, "info");
        return;
      }

      if (verb === "model") {
        if (value === "") {
          ctx.ui.notify(msg.planUsage(), "warning");
          return;
        }
        const resolved = resolveModel(ctx.modelRegistry, value);
        if (!resolved) {
          ctx.ui.notify(msg.unknownModel(value), "error");
          return;
        }
        state.config.plannerModel = canonicalModelId(resolved);
        persist(pi, state, ctx.cwd);
        ctx.ui.notify(msg.planModelSet(state), "info");
        return;
      }

      if (verb === "fallback") {
        if (value === "") {
          ctx.ui.notify(msg.planUsage(), "warning");
          return;
        }
        if (value.toLowerCase() === "none") {
          state.config.fallbackModels = [];
          persist(pi, state, ctx.cwd);
          ctx.ui.notify("Fallback models cleared.", "info");
          return;
        }
        const tokens = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const resolved: string[] = [];
        for (const token of tokens) {
          const model = resolveModel(ctx.modelRegistry, token);
          if (!model) {
            ctx.ui.notify(msg.unknownModel(token), "error");
            return;
          }
          resolved.push(canonicalModelId(model));
        }
        state.config.fallbackModels = resolved;
        persist(pi, state, ctx.cwd);
        ctx.ui.notify(`Fallback models set: ${resolved.join(", ")}`, "info");
        return;
      }

      if (verb === "help") {
        ctx.ui.notify(msg.planUsage(), "info");
        return;
      }

      ctx.ui.notify(msg.planUsage(), "warning");
    },
  });
}

// ---------- Interactive settings menu ----------

async function showPlanSettings(
  pi: ExtensionAPI,
  state: PlanState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const modeIcon = state.planActive ? "✅" : "⚪";
  const planSummary = state.currentPlan
    ? `${state.currentPlan.title} (${state.currentPlan.slices.length} slices)`
    : "none";

  const choice = await ctx.ui.select(
    "🧠 Plan Settings",
    [
      `${modeIcon} Plan mode: ${state.planActive ? "ON" : "OFF"}  — toggle`,
      `🤖 Model: ${state.config.plannerModel}  — change`,
      `🔄 Fallback: ${state.config.fallbackModels.length > 0 ? state.config.fallbackModels.join(", ") : "none"}  — change`,
      `📋 Plan: ${planSummary}`,
      state.currentPlan ? "📤 Export plan" : "",
      state.currentPlan ? "🗑️  Reset plan" : "",
    ].filter(Boolean),
  );

  if (!choice) return;

  // Toggle plan mode
  if (choice.includes("Plan mode")) {
    state.planActive = !state.planActive;
    applyPlanTools(pi, state.planActive);
    persist(pi, state, ctx.cwd);
    ctx.ui.notify(
      state.planActive
        ? `🧠 Plan mode ON — ${PLAN_TOOL} and ${REFINE_TOOL} tools are now active.`
        : "Plan mode OFF — planning tools deactivated.",
      "info",
    );
    return;
  }

  // Change model
  if (choice.includes("Model")) {
    await showModelPicker(pi, state, ctx);
    return;
  }

  // Change fallback
  if (choice.includes("Fallback")) {
    await showFallbackPicker(pi, state, ctx);
    return;
  }

  // Export plan
  if (choice.includes("Export")) {
    if (!state.currentPlan) return;
    const markdown = formatSpecMarkdown(state.currentPlan);
    ctx.ui.notify(
      `${markdown}\n\n---\n📄 Plan files: \`${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_FILE}\` and \`${CONFIG_DIR_NAME}/${PLAN_DIR}/${PLAN_EXPORT_FILE}\``,
      "info",
    );
    return;
  }

  // Reset plan
  if (choice.includes("Reset")) {
    const confirmed = await ctx.ui.confirm(
      "Reset plan",
      "Are you sure you want to clear the current plan? This cannot be undone.",
    );
    if (!confirmed) return;
    state.currentPlan = null;
    persist(pi, state, ctx.cwd);
    ctx.ui.notify(msg.planReset(), "info");
    return;
  }
}

async function showModelPicker(
  pi: ExtensionAPI,
  state: PlanState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const available = ctx.modelRegistry.getAvailable();
  const options = available.map((m) => {
    const id = canonicalModelId(m);
    const current = id === state.config.plannerModel ? " ← current" : "";
    return `${id}${current}`;
  });

  if (options.length === 0) {
    ctx.ui.notify("No models available. Check your API keys.", "error");
    return;
  }

  const choice = await ctx.ui.select("🤖 Select planner model", options);
  if (!choice) return;

  const modelId = choice.replace(" ← current", "");
  state.config.plannerModel = modelId;
  persist(pi, state, ctx.cwd);
  ctx.ui.notify(msg.planModelSet(state), "info");
}

async function showFallbackPicker(
  pi: ExtensionAPI,
  state: PlanState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const available = ctx.modelRegistry.getAvailable();
  const options = available
    .map((m) => canonicalModelId(m))
    .filter((id) => id !== state.config.plannerModel);

  const menuOptions = [
    "Clear all fallbacks",
    ...options.map((id) => {
      const isFallback = state.config.fallbackModels.includes(id);
      return `${isFallback ? "✅" : "⚪"} ${id}`;
    }),
  ];

  const choice = await ctx.ui.select("🔄 Select fallback model", menuOptions);
  if (!choice) return;

  if (choice === "Clear all fallbacks") {
    state.config.fallbackModels = [];
    persist(pi, state, ctx.cwd);
    ctx.ui.notify("Fallback models cleared.", "info");
    return;
  }

  // Toggle the selected model in the fallback list
  const modelId = choice.replace(/^[✅⚪] /, "");
  if (state.config.fallbackModels.includes(modelId)) {
    state.config.fallbackModels = state.config.fallbackModels.filter((id) => id !== modelId);
  } else {
    state.config.fallbackModels.push(modelId);
  }
  persist(pi, state, ctx.cwd);
  ctx.ui.notify(
    state.config.fallbackModels.length > 0
      ? `Fallback models: ${state.config.fallbackModels.join(", ")}`
      : "No fallback models configured.",
    "info",
  );
}
