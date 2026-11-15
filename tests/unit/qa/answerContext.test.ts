// qa/answerContext.ts: what the agent is told as the Answer view opens, changes and closes
// (ARCHITECTURE.md sections 5.6 and 8). One test per row.
import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_CONTEXT,
  answerContextUpdate,
  tellAnswerContext,
} from "@/qa/answerContext";

const drawn = (description: string) => ({
  kind: "drawn" as const,
  description,
});
const closed = { kind: "closed" as const };

describe("answerContextUpdate", () => {
  it("Lesson, a drawing arrives: Answer board showing: <description>", () => {
    expect(answerContextUpdate(false, drawn("why divide by root d"))).toBe(
      "Answer board showing: why divide by root d",
    );
  });

  it("Answer, a follow-up drawing replaces it: Answer board showing: <the new description>", () => {
    expect(answerContextUpdate(true, drawn("the second one"))).toBe(
      ANSWER_CONTEXT.showing("the second one"),
    );
  });

  it("a narrated answer (#105): the update also gives the narrator's words, so the agent knows them if they leak into the mic", () => {
    expect(
      answerContextUpdate(false, {
        ...drawn("why divide"),
        narration: "Dividing keeps the scores small.",
      }),
    ).toBe(
      `${ANSWER_CONTEXT.showing("why divide")}\n${ANSWER_CONTEXT.narrating("Dividing keeps the scores small.")}`,
    );
    expect(ANSWER_CONTEXT.narrating("x")).toContain("not the learner");
  });

  it("Answer, Ask closes: Back on the lesson.", () => {
    expect(answerContextUpdate(true, closed)).toBe("Back on the lesson.");
  });

  it("Lesson, Ask closes: nothing (the agent never left the lesson)", () => {
    expect(answerContextUpdate(false, closed)).toBeNull();
  });
});

describe("tellAnswerContext", () => {
  it("sends the update through tell", () => {
    const tell = vi.fn();
    tellAnswerContext(tell, true, closed);
    expect(tell).toHaveBeenCalledExactlyOnceWith(ANSWER_CONTEXT.back);
  });

  it("sends nothing when there's nothing to tell", () => {
    const tell = vi.fn();
    tellAnswerContext(tell, false, closed);
    expect(tell).not.toHaveBeenCalled();
  });
});
