// The "Updated because you asked…" marker (issue #102, ARCHITECTURE.md section 5.4): a step
// version the server regenerated after a learner's question or simplify request says so on
// the tutor card while it plays. Pure: Player.tsx shows it.
import type { AdaptedFrom } from "@/shared/lesson";

/** Longer questions are cut to this many characters, plus "…". */
export const MARKER_QUESTION_MAX = 60;

export const ADAPTED_TEXT = {
  question: "Updated because you asked:",
  simplify: "Made simpler because you asked",
} as const;

/** What the marker says, or null for a step that wasn't adapted. */
export function adaptedMarker(
  from: AdaptedFrom | undefined,
): { lead: string; quote: string | null } | null {
  if (from === undefined) return null;
  if (from.kind === "simplify")
    return { lead: ADAPTED_TEXT.simplify, quote: null };
  const text = from.text.trim().replace(/\s+/g, " ");
  const quote =
    text.length > MARKER_QUESTION_MAX
      ? `${text.slice(0, MARKER_QUESTION_MAX).trimEnd()}…`
      : text;
  return { lead: ADAPTED_TEXT.question, quote };
}
