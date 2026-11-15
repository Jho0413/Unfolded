// A narrated answer (#105) for the specs that fake POST /api/sketch: the route's response
// ({ sketch, audioUrl, cueTimes }) and a silent MP3 for its audio, served where the page asks
// for it (GET /api/runs/<lessonId>/answers/<file>). No provider is called.
import type { Page } from "@playwright/test";
import type { CueTimes } from "@/shared/lesson";
import { silentMp3 } from "./savedRun";

/** The answers' audio URL the fake responses point at. */
export const ANSWER_AUDIO_URL = "/api/runs/e2e-answer/answers/e2e-answer.mp3";

/**
 * The route's reply for a sketch, as the page receives it (a spec's sketch literal, valid or
 * not on purpose): its audio is ANSWER_AUDIO_URL.
 */
export function narratedReply(sketch: unknown, cueTimes: CueTimes = {}) {
  return { sketch, audioUrl: ANSWER_AUDIO_URL, cueTimes };
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
