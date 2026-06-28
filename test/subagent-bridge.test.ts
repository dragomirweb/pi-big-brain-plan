import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBridgeTask, runViaBridge } from "../src/subagent-bridge.ts";

// ---------- buildBridgeTask ----------

describe("buildBridgeTask", () => {
  it("assembles task with reads and dynamic context", () => {
    const result = buildBridgeTask("Plan this", "## Existing plan\nRefine it", [
      "plan.json",
      "src/foo.ts",
    ]);
    expect(result).toContain("## Read these files first");
    expect(result).toContain("- plan.json");
    expect(result).toContain("- src/foo.ts");
    expect(result).toContain("## Existing plan");
    expect(result).toContain("Plan this");
  });

  it("skips reads section when empty", () => {
    const result = buildBridgeTask("Plan this", undefined, []);
    expect(result).not.toContain("## Read these files first");
    expect(result).toBe("Plan this");
  });

  it("includes dynamic context without reads", () => {
    const result = buildBridgeTask("Plan this", "## Feedback\nFix slice s1", []);
    expect(result).toContain("## Feedback");
    expect(result).toContain("Plan this");
  });
});

// ---------- runViaBridge ----------

describe("runViaBridge", () => {
  let handlers: Map<string, Array<(data: unknown) => void>>;
  let mockPi: { events: { emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } };
  let mockCtx: ExtensionContext;

  beforeEach(() => {
    handlers = new Map();
    mockPi = {
      events: {
        emit: vi.fn((channel: string, data: unknown) => {
          const fns = handlers.get(channel) ?? [];
          for (const fn of fns) fn(data);
        }),
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          if (!handlers.has(channel)) handlers.set(channel, []);
          handlers.get(channel)?.push(handler);
          return () => {
            const arr = handlers.get(channel);
            if (arr) {
              const idx = arr.indexOf(handler);
              if (idx !== -1) arr.splice(idx, 1);
            }
          };
        }),
      },
    };
    mockCtx = { cwd: "/test" } as unknown as ExtensionContext;
  });

  it("returns null when pi-subagents does not respond (timeout)", async () => {
    // Use a very short bridge detect timeout via fake timers
    vi.useFakeTimers();
    const promise = runViaBridge(
      mockPi as unknown as ExtensionAPI,
      mockCtx,
      "big-brain-planner",
      "Plan something",
      undefined,
      undefined,
    );

    // The bridge emits a request
    expect(mockPi.events.emit).toHaveBeenCalledWith(
      "subagent:slash:request",
      expect.objectContaining({
        params: expect.objectContaining({ agent: "big-brain-planner" }),
      }),
    );

    // Fast-forward past the 5s detect timeout
    vi.advanceTimersByTime(6000);
    const result = await promise;
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("returns the result when pi-subagents responds", async () => {
    const promise = runViaBridge(
      mockPi as unknown as ExtensionAPI,
      mockCtx,
      "big-brain-planner",
      "Plan something",
      undefined,
      undefined,
    );

    // Simulate pi-subagents responding
    const requestCall = mockPi.events.emit.mock.calls.find(
      (call) => call[0] === "subagent:slash:request",
    );
    const requestId = (requestCall?.[1] as { requestId: string }).requestId;

    // Emit started
    for (const fn of handlers.get("subagent:slash:started") ?? []) {
      fn({ requestId });
    }

    // Emit response
    for (const fn of handlers.get("subagent:slash:response") ?? []) {
      fn({
        requestId,
        result: {
          content: [{ type: "text", text: "Here is the plan JSON..." }],
          details: {
            results: [
              {
                usage: {
                  input: 100,
                  output: 5000,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: 0.1,
                  turns: 2,
                },
              },
            ],
          },
        },
        isError: false,
      });
    }

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.content[0]).toEqual({ type: "text", text: "Here is the plan JSON..." });
    expect(result?.details.usage.output).toBe(5000);
    expect(result?.details.usage.turns).toBe(2);
  });

  it("returns error result when pi-subagents returns isError", async () => {
    const promise = runViaBridge(
      mockPi as unknown as ExtensionAPI,
      mockCtx,
      "big-brain-refiner",
      "Refine slice s1",
      undefined,
      undefined,
    );

    const requestCall = mockPi.events.emit.mock.calls.find(
      (call) => call[0] === "subagent:slash:request",
    );
    const requestId = (requestCall?.[1] as { requestId: string }).requestId;

    for (const fn of handlers.get("subagent:slash:response") ?? []) {
      fn({
        requestId,
        result: { content: [{ type: "text", text: "Model unavailable" }], details: {} },
        isError: true,
        errorText: "Model unavailable",
      });
    }

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.content[0]).toEqual({ type: "text", text: "Model unavailable" });
  });

  it("calls onUpdate when progress events arrive", async () => {
    const onUpdate = vi.fn();
    const promise = runViaBridge(
      mockPi as unknown as ExtensionAPI,
      mockCtx,
      "big-brain-planner",
      "Plan something",
      undefined,
      onUpdate,
    );

    const requestCall = mockPi.events.emit.mock.calls.find(
      (call) => call[0] === "subagent:slash:request",
    );
    const requestId = (requestCall?.[1] as { requestId: string }).requestId;

    // Emit update
    for (const fn of handlers.get("subagent:slash:update") ?? []) {
      fn({
        requestId,
        progress: [{ currentTool: "read", tokens: 500 }],
      });
    }

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: "text", text: "Subagent running read…" }],
      }),
    );

    // Resolve to clean up
    for (const fn of handlers.get("subagent:slash:response") ?? []) {
      fn({
        requestId,
        result: { content: [{ type: "text", text: "done" }], details: {} },
        isError: false,
      });
    }

    await promise;
  });

  it("emits cancel event on abort", async () => {
    const controller = new AbortController();
    const promise = runViaBridge(
      mockPi as unknown as ExtensionAPI,
      mockCtx,
      "big-brain-planner",
      "Plan something",
      controller.signal,
      undefined,
    );

    controller.abort();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.content[0]).toEqual({ type: "text", text: "Planning aborted." });
    expect(mockPi.events.emit).toHaveBeenCalledWith(
      "subagent:slash:cancel",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });
});
