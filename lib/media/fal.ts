// fal, server-side only (ARCHITECTURE.md sections 1, 5.1 and 11, S4): one image from a prompt,
// downloaded at once, since fal's URLs expire. Optional: with no FAL_KEY there is no image
// maker and every image is hidden. FAKE_APIS=1 serves S4's recorded result (lib/fakes/fal.ts),
// and replay never calls fal.
import "server-only";
import { createFalClient } from "@fal-ai/client";
import { z } from "zod";
import { config } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { fakeImages } from "@/lib/fakes/fal";

/**
 * Makes one image from a prompt and returns its bytes, already downloaded. The caller owns
 * the deadline: it aborts `signal` when it gives up, and the maker stops what it can (and
 * asks fal to cancel a queued request).
 */
export interface ImageMaker {
  make(prompt: string, signal: AbortSignal): Promise<Uint8Array>;
}

/** The part of a FLUX result we use. fal's answer is checked here, where it enters. */
export const FalImageResult = z.object({
  images: z
    .array(
      z.object({
        url: z.url({ protocol: /^https$/ }),
        content_type: z.string(),
      }),
    )
    .min(1),
});

/** The image maker for this mode, or undefined when images are hidden (no FAL_KEY, replay). */
export function falImages(): ImageMaker | undefined {
  const env = getEnv();
  switch (env.mode) {
    case "real":
      return env.FAL_KEY === undefined ? undefined : realImages(env.FAL_KEY);
    case "fake":
      return fakeImages();
    case "replay":
      return undefined;
  }
}

function realImages(key: string): ImageMaker {
  // A key passed in code is the client's only credential: it never reads FAL_KEY itself.
  const fal = createFalClient({ credentials: key });
  const model = config.fal.model;
  return {
    async make(prompt, signal) {
      let requestId: string | undefined;
      // fal.subscribe's abortSignal stops the client but leaves the request queued at fal,
      // still to be charged: cancel it (fal can't cancel one that's already running). An
      // abort before fal answers the submit has no request id, so there's nothing to cancel.
      const cancel = () => {
        if (requestId === undefined) return;
        fal.queue.cancel(model, { requestId }).catch((err: unknown) => {
          console.warn("[fal]", `couldn't cancel request ${requestId}:`, err);
        });
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await fal.subscribe(model, {
          input: {
            prompt,
            image_size: config.fal.imageSize,
            output_format: "jpeg",
          },
          abortSignal: signal,
          onEnqueue: (id) => {
            requestId = id;
          },
        });
        const { url } = FalImageResult.parse(result.data).images[0];
        return await download(url, signal);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}

async function download(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`fal image download: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
