// ElevenLabs v4 voice tags ("[calm]", "[laughs]") steer the agent's voice but arrive in its
// text too. The Ask panel strips them before showing the agent's words. Conservative: only a
// lowercase word of two or more letters in brackets, standing alone between spaces (or at the
// start or end), so bracketed maths such as "a[i]" or "[x]" is left as it is.
const VOICE_TAG = /(^|\s)\[[a-z]{2,}\](?=\s|$)/g;

export function stripVoiceTags(text: string): string {
  if (!text.includes("[")) return text;
  return text.replace(VOICE_TAG, "$1").replace(/ {2,}/g, " ").trim();
}
