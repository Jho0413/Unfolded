// A narrated answer (#105) for the specs that fake POST /api/sketch: the route's response
// ({ sketch, audioUrl, cueTimes }) and a silent MP3 for its audio, served where the page asks
// for it (GET /api/runs/<lessonId>/answers/<file>). No provider is called.
import type { Page, Route } from "@playwright/test";
import type { CueTimes } from "@/shared/lesson";
import { silentMp3 } from "./savedRun";

/** The fake answers' audio file, in the asking lesson's answers folder. */
const ANSWER_AUDIO_FILE = "e2e-answer.mp3";

/** The lessonId a POST /api/sketch request was sent with (the page checks the reply's audio is its own). */
export function lessonOf(route: Route): string {
  return (route.request().postDataJSON() as { lessonId: string }).lessonId;
}

/** The specs' sketches cue every action on "c" ("[[c]]Here it is."), spoken at once. */
const SAID_AT_ONCE: CueTimes = { c: 0 };

/**
 * The route's reply for a sketch, as the page receives it (a spec's sketch literal, valid or
 * not on purpose), with its audio in `lessonId`'s answers folder.
 */
export function narratedReply(
  lessonId: string,
  sketch: unknown,
  cueTimes: CueTimes = SAID_AT_ONCE,
) {
  return {
    sketch,
    audioUrl: `/api/runs/${lessonId}/answers/${ANSWER_AUDIO_FILE}`,
    cueTimes,
  };
}

/** Serves every answer's audio as a silent MP3 of `durationMs` (or a status, to fail it). */
export async function fakeAnswerAudio(
  page: Page,
  durationMs = 2000,
  status = 200,
): Promise<void> {
  await page.route("**/api/runs/*/answers/*", (route) =>
    status === 200
      ? route.fulfill({
          body: Buffer.from(silentMp3(durationMs)),
          contentType: "audio/mpeg",
        })
      : route.fulfill({ status, json: { error: "missing" } }),
  );
}
