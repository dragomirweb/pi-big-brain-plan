import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import piBigBrainPlan from "../src/index.ts";
import { makeMockPi } from "./helpers/mock-pi.ts";

describe("piBigBrainPlan", () => {
  it("registers the plan command and both tools", () => {
    const { pi, commands, tools } = makeMockPi();
    piBigBrainPlan(pi);

    expect(commands.has("plan")).toBe(true);
    expect(tools.has("big_brain_plan")).toBe(true);
    expect(tools.has("refine_slice")).toBe(true);
  });

  it("registers only a fallback command on an unsupported host", async () => {
    type CommandDefinition = Parameters<ExtensionAPI["registerCommand"]>[1];
    const registered: Array<{ name: string; def: CommandDefinition }> = [];
    const notify = vi.fn();
    const pi = {
      registerCommand: (name: string, def: CommandDefinition) => registered.push({ name, def }),
    } as unknown as ExtensionAPI;

    piBigBrainPlan(pi);

    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("plan");

    const ctx = { ui: { notify } } as unknown as Parameters<CommandDefinition["handler"]>[1];
    await registered[0].def.handler("", ctx);
    expect(notify).toHaveBeenCalledWith(expect.any(String), "error");
  });
});
