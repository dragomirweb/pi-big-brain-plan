import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

type PlannerUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
};

export type PlannerDetails = {
  usage: PlannerUsage;
};

type JsonObject = Record<string, unknown>;

let spawnTimeoutMs = 300_000;

export function setSpawnTimeoutMs(ms: number): void {
  spawnTimeoutMs = ms;
}

export async function runSubagent(
  model: string,
  systemPromptText: string,
  task: string,
  tools: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<PlannerDetails> | undefined,
  cwd: string,
): Promise<AgentToolResult<PlannerDetails>> {
  const { file: sysPromptFile, dir: sysPromptDir } = writeSystemPrompt(systemPromptText);
  const { command, args } = getPiInvocation(buildArgs(model, sysPromptFile, task, tools));

  const messages: JsonObject[] = [];
  const toolEvents: JsonObject[] = [];
  const usage = emptyUsage();
  let stderr = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const proc = spawn(command, args, {
        cwd,
        env: { ...process.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const killWorker = () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        killTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, 2_000);
        killTimer.unref?.();
        proc.once("exit", () => {
          if (killTimer) clearTimeout(killTimer);
        });
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: JsonObject;
        try {
          event = JSON.parse(line) as JsonObject;
        } catch {
          return;
        }

        const eventType = typeof event.type === "string" ? event.type : undefined;
        if (eventType === "message_end" && isObject(event.message)) {
          const message = event.message;
          messages.push(message);
          if (message.role === "assistant") {
            usage.turns += 1;
            mergeUsage(usage, message.usage);
            if (typeof message.stopReason === "string") stopReason = message.stopReason;
            if (typeof message.errorMessage === "string") errorMessage = message.errorMessage;
          }
          onUpdate?.(partialResult(getFinalText(messages) || "(planning…)", usage));
          return;
        }

        if (eventType === "tool_execution_start" || eventType === "tool_execution_end") {
          toolEvents.push(event);
          onUpdate?.(partialResult(renderProgress(event), usage));
        }
      };

      const onAbort = () =>
        finish(() => {
          killWorker();
          reject(new Error("Planning aborted."));
        });

      const timer = setTimeout(
        () =>
          finish(() => {
            killWorker();
            reject(new Error(`Planning timed out after ${spawnTimeoutMs}ms.`));
          }),
        spawnTimeoutMs,
      );

      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => finish(() => reject(err)));
      proc.on("close", (code) =>
        finish(() => {
          if (killTimer) clearTimeout(killTimer);
          if (buffer.trim()) processLine(buffer);
          resolve(code ?? 0);
        }),
      );
    });

    if (exitCode !== 0) {
      throw new Error(`Planner exited ${exitCode}: ${tail(stderr) || "(no stderr)"}`);
    }
    if (stopReason === "error" || stopReason === "aborted") {
      throw new Error(`Planner stopped (${stopReason}): ${errorMessage ?? tail(stderr)}`);
    }
    if (messages.length === 0 && isModelUnavailable(new Error(stderr))) {
      throw new Error(`model-unavailable: ${tail(stderr, 300)}`);
    }
    if (messages.length === 0 && toolEvents.length === 0) {
      throw new Error(`Planner produced no output. ${tail(stderr, 300) || "(no stderr)"}`);
    }

    return formatResult(messages, usage);
  } finally {
    rmSync(sysPromptDir, { force: true, recursive: true });
  }
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtual = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtual && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  return isGenericRuntime ? { command: "pi", args } : { command: process.execPath, args };
}

function buildArgs(model: string, sysPromptFile: string, task: string, tools: string): string[] {
  return [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--model",
    model,
    "--tools",
    tools,
    "--append-system-prompt",
    sysPromptFile,
    task,
  ];
}

function writeSystemPrompt(text: string): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-planner-"));
  const file = join(dir, "system-prompt.md");
  writeFileSync(file, text, { mode: 0o600 });
  return { file, dir };
}

function emptyUsage(): PlannerUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

function mergeUsage(target: PlannerUsage, usage: unknown): void {
  if (!isObject(usage)) return;
  target.input += numeric(usage.input) ?? numeric(usage.inputTokens) ?? 0;
  target.output += numeric(usage.output) ?? numeric(usage.outputTokens) ?? 0;
  target.cacheRead += numeric(usage.cacheRead) ?? numeric(usage.cacheReadTokens) ?? 0;
  target.cacheWrite += numeric(usage.cacheWrite) ?? numeric(usage.cacheWriteTokens) ?? 0;
  const cost = isObject(usage.cost) ? numeric(usage.cost.total) : numeric(usage.cost);
  target.cost += cost ?? 0;
  target.contextTokens =
    numeric(usage.totalTokens) ?? numeric(usage.contextTokens) ?? target.contextTokens;
}

function partialResult(text: string, usage: PlannerUsage): AgentToolResult<PlannerDetails> {
  return { content: [{ type: "text", text }], details: { usage: { ...usage } } };
}

function formatResult(
  messages: JsonObject[],
  usage: PlannerUsage,
): AgentToolResult<PlannerDetails> {
  const text = getFinalText(messages) || "Planner completed without a final summary.";
  return { content: [{ type: "text", text }], details: { usage: { ...usage } } };
}

function getFinalText(messages: JsonObject[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const text = contentText(message.content);
    if (text) return text;
  }
  return "";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (isObject(part) && part.type === "text" && typeof part.text === "string")
          return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (isObject(content) && typeof content.text === "string") return content.text.trim();
  return "";
}

function renderProgress(event: JsonObject): string {
  const type = typeof event.type === "string" ? event.type : "tool_execution";
  const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
  if (type === "tool_execution_start") return `Planner running ${toolName}…`;
  return `Planner finished ${toolName}.`;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function tail(value: string, length = 500): string {
  return value.slice(-length).trim();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function isModelUnavailable(err: Error): boolean {
  const m = err.message;
  return (
    /\b(no api key|missing api key|invalid api key|unauthorized|authentication failed|401|403)\b/i.test(
      m,
    ) ||
    /\b(unknown|invalid|unsupported|unavailable)\s+model\b/i.test(m) ||
    /\bmodel\b[^.]*\b(not found|not available|unavailable|does not exist|is not configured)\b/i.test(
      m,
    ) ||
    /\bno models?\s+available\b/i.test(m) ||
    /\bprovider\b[^.]*\b(not found|not configured|unavailable|unknown)\b/i.test(m) ||
    /\bmodel-unavailable\b/i.test(m)
  );
}
