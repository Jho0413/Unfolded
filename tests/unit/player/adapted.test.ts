// The "Updated because you asked…" marker (issue #102, player/adapted.ts).
import { describe, expect, it } from "vitest";
import {
  ADAPTED_TEXT,
  adaptedMarker,
  MARKER_QUESTION_MAX,
} from "@/player/adapted";

describe("adaptedMarker", () => {
  it("nothing for a step that wasn't adapted", () => {
    expect(adaptedMarker(undefined)).toBeNull();
  });

  it("quotes the question", () => {
    expect(
      adaptedMarker({
        kind: "question",
        text: "why divide by √d?",
        atStep: 1,
      }),
    ).toEqual({ lead: ADAPTED_TEXT.question, quote: "why divide by √d?" });
  });

  it("cuts a long question and folds its whitespace", () => {
    const long = `why\n  ${"a".repeat(100)}`;
    const m = adaptedMarker({ kind: "question", text: long, atStep: 0 });
    expect(m?.quote?.endsWith("…")).toBe(true);
    expect(m?.quote?.length).toBeLessThanOrEqual(MARKER_QUESTION_MAX + 1);
    expect(m?.quote?.startsWith("why a")).toBe(true);
  });

  it("a simplify request isn't quoted (the agent wrote the reason)", () => {
    expect(
      adaptedMarker({ kind: "simplify", text: "lost at softmax", atStep: 2 }),
    ).toEqual({ lead: ADAPTED_TEXT.simplify, quote: null });
  });
});
