// Client tool calls from the agent are checked against shared/tools.ts before
// any handler runs (ARCHITECTURE.md section 8).
import { describe, expect, it, vi } from "vitest";
import { callTool } from "@/qa/callTool";

describe("callTool", () => {
  it("calls the handler with the parsed parameters", async () => {
    const highlight = vi.fn(() => "ok");
    await expect(
      callTool({ highlight }, "highlight", { target_id: "q", row: 0 }),
    ).resolves.toBe("ok");
    expect(highlight).toHaveBeenCalledWith({ target_id: "q", row: 0 });
  });

  it("applies schema defaults (draw_scene fresh = false)", async () => {
    const draw = vi.fn();
    await callTool({ draw_scene: draw }, "draw_scene", {
      description: "a box",
    });
    expect(draw).toHaveBeenCalledWith({ description: "a box", fresh: false });
  });

  it("rejects bad parameters without calling the handler", async () => {
    const highlight = vi.fn(() => "ok");
    const result = await callTool({ highlight }, "highlight", { target_id: 5 });
    expect(result).toMatch(/^bad parameters for highlight: target_id: /);
    expect(highlight).not.toHaveBeenCalled();
  });

  it("rejects a 0 step for go_to_step (1-based)", async () => {
    const goTo = vi.fn(() => "ok");
    const result = await callTool({ go_to_step: goTo }, "go_to_step", {
      step: 0,
    });
    expect(result).toMatch(/^bad parameters for go_to_step: step: /);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("tells the agent when a tool has no handler", async () => {
    await expect(callTool({}, "highlight", { target_id: "q" })).resolves.toBe(
      'tool "highlight" isn\'t available',
    );
  });
});
