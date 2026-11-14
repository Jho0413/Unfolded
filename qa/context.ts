// The Q&A agent's context message (ARCHITECTURE.md section 8). Pure: the Ask
// panel sends the result through sendContextualUpdate() when the session
// connects and on every step change, so the agent knows what "this" means and
// which ids `highlight` can use.
import { CUE_MARKER_RE } from "@/shared/scene";

export type QaContext = {
  /** The plan's step titles, in order. */
  planTitles: readonly string[];
  /** The current step, 0-based: the one on the board. */
  step: number;
  /**
   * A step the agent jumped to (go_to_step), 0-based. It loads once Ask
   * closes; until then the board stays on `step` (section 8).
   */
  nextStep?: number;
  /**
   * The current step's narration up to where it was paused (markers stripped,
   * see `narrationUpTo`), or null while the step is loading.
   */
  narrationSoFar: string | null;
  /** The current step's goal from the plan, sent while the step is loading. */
  stepGoal?: string;
  /** Ids of the objects on the board. */
  boardIds: readonly string[];
  /** Questions asked earlier in this lesson, oldest first. */
  earlierQuestions: readonly string[];
};

/** The text sent to the agent through sendContextualUpdate(). */
export function buildContextUpdate(ctx: QaContext): string {
  const lines: string[] = ["Lesson plan:"];
  ctx.planTitles.forEach((title, i) => {
    const mark =
      i === ctx.step
        ? " (current step)"
        : i === ctx.nextStep
          ? " (next, after this question)"
          : "";
    lines.push(`${i + 1}. ${title}${mark}`);
  });
  lines.push("");
  if (ctx.nextStep !== undefined && ctx.nextStep !== ctx.step) {
    lines.push(
      `After this question the lesson goes to step ${ctx.nextStep + 1}; the board stays on step ${ctx.step + 1} until then.`,
    );
  }
  if (ctx.narrationSoFar !== null) {
    const said = ctx.narrationSoFar.trim();
    lines.push(
      `Narration of step ${ctx.step + 1} so far: ${said === "" ? "(nothing yet)" : `"${said}"`}`,
    );
  } else {
    lines.push(
      `Step ${ctx.step + 1} is still loading.` +
        (ctx.stepGoal ? ` Its goal: ${ctx.stepGoal}` : ""),
    );
  }
  lines.push(
    ctx.boardIds.length > 0
      ? `Objects on the board (ids for highlight): ${ctx.boardIds.join(", ")}`
      : "The board is empty.",
  );
  if (ctx.earlierQuestions.length > 0) {
    lines.push("Questions asked earlier in this lesson:");
    for (const q of ctx.earlierQuestions) lines.push(`- ${q}`);
  }
  return lines.join("\n");
}

/**
 * The narration the learner has heard by `tMs`: the text before the first cue
 * marker timed after `tMs`, with markers stripped. Cues missing from
 * `cueTimes` don't cut the text. Pass Infinity once the step has ended.
 */
export function narrationUpTo(
  narration: string,
  cueTimes: Readonly<Record<string, number>>,
  tMs: number,
): string {
  let end = narration.length;
  for (const m of narration.matchAll(CUE_MARKER_RE)) {
    const at = cueTimes[m[1]];
    if (Object.hasOwn(cueTimes, m[1]) && at !== undefined && at > tMs) {
      end = m.index;
      break;
    }
  }
  return narration.slice(0, end).replace(CUE_MARKER_RE, "");
}
