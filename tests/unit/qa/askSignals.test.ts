// The learner's Ask signals (issue #102, qa/askSignals.ts, ARCHITECTURE.md section 5.4).
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_TOOLS,
  createAskSignals,
  isAnswerControl,
  noteCommands,
} from "@/qa/askSignals";
import type { QaTools } from "@/qa/types";
import type { Signal } from "@/shared/lesson";

function harness(recorded = true) {
  const posted: Signal[] = [];
  let where = { step: 1, t: 2500.4 };
  const signals = createAskSignals({
    post: async (s) => {
      posted.push(s);
      return recorded;
    },
    where: () => where,
  });
  return {
    signals,
    posted,
    moveTo: (step: number, t: number) => (where = { step, t }),
  };
}

describe("createAskSignals", () => {
  it("a question is held until Ask closes, then posted with where it was asked", async () => {
    const h = harness();
    h.signals.heard("  why divide by √d? ");
    h.moveTo(2, 0);
    expect(h.posted).toEqual([]);
    expect(await h.signals.flush()).toBe(true);
    expect(h.posted).toEqual([
      { question: "why divide by √d?", step: 1, t: 2500 },
    ]);
  });

  it("the next message posts the one before it", () => {
    const h = harness();
    h.signals.heard("first");
    h.moveTo(1, 3000);
    h.signals.heard("second");
    expect(h.posted).toEqual([{ question: "first", step: 1, t: 2500 }]);
  });

  it("a control tool drops the message it answered: a command is not a question", async () => {
    const h = harness();
    h.signals.heard("carry on");
    h.signals.command();
    expect(await h.signals.flush()).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it("a command drops only the latest message", async () => {
    const h = harness();
    h.signals.heard("what is softmax?");
    h.signals.heard("ok, carry on");
    h.signals.command();
    await h.signals.flush();
    expect(h.posted).toEqual([
      { question: "what is softmax?", step: 1, t: 2500 },
    ]);
  });

  it("simplify posts at once", () => {
    const h = harness();
    h.signals.simplify("lost at softmax");
    expect(h.posted).toEqual([
      { simplify: "lost at softmax", step: 1, t: 2500 },
    ]);
  });

  it("blank messages and reasons are ignored", async () => {
    const h = harness();
    h.signals.heard("   ");
    h.signals.simplify("");
    expect(await h.signals.flush()).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it("flush says whether anything was recorded since the last flush", async () => {
    const h = harness(false);
    h.signals.heard("q");
    expect(await h.signals.flush()).toBe(false); // the server didn't record it (404)
    const ok = harness();
    ok.signals.simplify("s");
    expect(await ok.signals.flush()).toBe(true);
    expect(await ok.signals.flush()).toBe(false);
  });

  it("every post sent is a valid Signal body", async () => {
    const { Signal } = await import("@/shared/lesson");
    const h = harness();
    h.signals.heard("a");
    h.signals.simplify("b");
    await h.signals.flush();
    for (const s of h.posted) expect(Signal.safeParse(s).success).toBe(true);
  });
});

describe("isAnswerControl (holding or steering a drawn answer, demo rehearsal)", () => {
  it.each([
    "hold on",
    "Hold on.",
    "ok, hold on please",
    "wait",
    "wait wait",
    "Hold on, hold on!",
    "wait a second",
    "hang on",
    "pause",
    "stop",
    "okay carry on",
    "go on",
    "continue",
    "keep going",
    "say that again",
    "sorry, say that again please",
    "once more",
  ])("%s: only a command", (text) => {
    expect(isAnswerControl(text)).toBe(true);
  });

  it.each([
    "hold on, why is it squared?",
    "wait what does temperature do",
    "why do we divide by root d",
    "carry on with the next idea about softmax",
    "stop sign",
    "",
    "ok",
  ])("%s: not only a command", (text) => {
    expect(isAnswerControl(text)).toBe(false);
  });
});

describe("heard while a drawn answer is up", () => {
  it("'hold on' over the Answer view is never posted, and isn't a question", async () => {
    const h = harness();
    h.signals.heard("hold on", { answerShowing: true });
    expect(await h.signals.flush()).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it("the question before it still posts; a real question over the answer still counts", async () => {
    const h = harness();
    h.signals.heard("why is it squared?", { answerShowing: true });
    h.signals.heard("wait", { answerShowing: true });
    h.signals.heard("and what about the bias?", { answerShowing: true });
    await h.signals.flush();
    expect(h.posted.map((s) => ("question" in s ? s.question : null))).toEqual([
      "why is it squared?",
      "and what about the bias?",
    ]);
  });

  it("'hold on' on the lesson board (no Answer view) is held as before (a control tool drops it)", async () => {
    const h = harness();
    h.signals.heard("hold on");
    h.signals.heard("hold on", { answerShowing: false });
    await h.signals.flush();
    expect(h.posted).toHaveLength(2);
  });
});

describe("noteCommands", () => {
  it("each control tool notes a command before running; other tools don't", () => {
    const calls: string[] = [];
    const tools: QaTools = Object.fromEntries(
      [...COMMAND_TOOLS, "highlight", "draw_scene", "simplify_upcoming"].map(
        (name) => [name, () => calls.push(name)],
      ),
    );
    const command = vi.fn(() => calls.push("command"));
    const noted = noteCommands(tools, command);
    for (const name of COMMAND_TOOLS) {
      calls.length = 0;
      (noted[name] as (p: unknown) => void)({});
      expect(calls, name).toEqual(["command", name]);
    }
    command.mockClear();
    (noted.highlight as (p: unknown) => void)({});
    (noted.draw_scene as (p: unknown) => void)({});
    (noted.simplify_upcoming as (p: unknown) => void)({});
    expect(command).not.toHaveBeenCalled();
  });

  it("passes the tool's result back to the agent", () => {
    const noted = noteCommands({ go_to_step: () => "ok" }, () => {});
    expect(noted.go_to_step?.({ step: 2 })).toBe("ok");
  });
});
