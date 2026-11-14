// A fake fal for the cover (ARCHITECTURE.md section 10). With no script it answers every
// request with S4's recorded flux-2 result and a small copy of its image (FAKE_APIS=1); tests
// pass a script of replies and read back the prompts it got.
import "server-only";
import { config } from "@/lib/config";
import { readFixture, readFixtureBytes } from "@/lib/fakes";
import { FalImageResult, type Image, type ImageMaker } from "@/lib/media/fal";

/**
 * A reply the fake gives: an image, an error it throws (as the client would), or "hang": it
 * never answers and ignores the abort, so only the caller's own deadline can end the wait.
 */
export type FakeImageReply = Image | Error | "hang";

export interface FakeImages extends ImageMaker {
  /** The prompt of every request, in order. */
  readonly prompts: string[];
}

/** The recorded image: the fixture's result is checked like a real one, then its bytes. */
export async function fixtureImage(): Promise<Image> {
  FalImageResult.parse(await readFixture(config.fal.fixture));
  return {
    bytes: await readFixtureBytes(config.fal.fixtureImage),
    contentType: "image/jpeg",
  };
}

/** Serves `replies` in order, one per request; a request past the end fails the test. */
export function fakeImages(replies?: readonly FakeImageReply[]): FakeImages {
  const prompts: string[] = [];
  return {
    prompts,
    async make(prompt) {
      prompts.push(prompt);
      if (replies === undefined) return fixtureImage();
      const reply = replies[prompts.length - 1];
      if (reply === undefined)
        throw new Error(
          `fakeImages: request ${prompts.length}, but only ${replies.length} replies scripted`,
        );
      if (reply === "hang") return new Promise<Image>(() => {});
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}
