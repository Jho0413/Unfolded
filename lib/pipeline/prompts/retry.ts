// The user turn sent after a rejected answer (ARCHITECTURE.md section 4): the validator's
// messages, then the ask to write the whole answer again. One wording for steps, sketches
// and plans.
import "server-only";

/** A retry prompt for `thing` ("step"), asking Claude to `verb` ("Write") it again. */
export function retryPromptFor(
  thing: string,
  verb: string,
): (errors: readonly string[]) => string {
  return (errors) =>
    `That ${thing} was rejected:\n${errors.map((e) => `- ${e}`).join("\n")}\n\n${verb} the whole ${thing} again, fixing every problem listed.`;
}
