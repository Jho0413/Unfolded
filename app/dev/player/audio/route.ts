// DEV ONLY: the fake lesson's audio (app/dev/player/fakeLesson.ts).
//   ?kind=ok        a silent WAV, FAKE_AUDIO_MS long
//   ?kind=broken    200, but the bytes aren't audio (the player can't decode them)
//   ?kind=missing   404
// 404s in production unless in fake mode (app/dev/devOnly.ts).
import { devPagesEnabled } from "../../devOnly";
import { FAKE_AUDIO_MS } from "../fakeLesson";
import { silentWav } from "../silentWav";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function GET(request: Request): Promise<Response> {
  if (!(await devPagesEnabled())) return NOT_FOUND();
  const kind = new URL(request.url).searchParams.get("kind") ?? "ok";
  const headers = { "Content-Type": "audio/wav", "Cache-Control": "no-store" };
  switch (kind) {
    case "ok":
      return new Response(silentWav(FAKE_AUDIO_MS), { headers });
    case "broken":
      return new Response("this is not audio", { headers });
    default:
      return NOT_FOUND();
  }
}
