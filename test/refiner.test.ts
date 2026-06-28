import { describe, expect, it } from "vitest";

import { extractRefineJson } from "../src/refiner.ts";

describe("extractRefineJson", () => {
  it("extracts valid refinement JSON with sliceId key", () => {
    const json = JSON.stringify({ sliceId: "s1", title: "Updated", tasks: [] });
    const text = `Analysis:\n\n\`\`\`json\n${json}\n\`\`\``;
    const result = extractRefineJson(text);
    expect(result).not.toBeNull();
    expect(result?.sliceId).toBe("s1");
  });

  it("returns null when no JSON block present", () => {
    expect(extractRefineJson("No JSON here")).toBeNull();
  });

  it("returns null when JSON lacks sliceId key", () => {
    const json = JSON.stringify({ title: "No sliceId" });
    const text = `\`\`\`json\n${json}\n\`\`\``;
    expect(extractRefineJson(text)).toBeNull();
  });

  it("handles case-insensitive JSON fences", () => {
    const json = JSON.stringify({ sliceId: "s2", title: "Case test" });
    const text = `\`\`\`JSON\n${json}\n\`\`\``;
    const result = extractRefineJson(text);
    expect(result).not.toBeNull();
    expect(result?.sliceId).toBe("s2");
  });

  it("picks the last JSON block when multiple exist", () => {
    const first = JSON.stringify({ sliceId: "s1" });
    const second = JSON.stringify({ sliceId: "s2", title: "Last" });
    const text = `\`\`\`json\n${first}\n\`\`\`\n\nMore text\n\n\`\`\`json\n${second}\n\`\`\``;
    const result = extractRefineJson(text);
    expect(result?.sliceId).toBe("s2");
  });
});
