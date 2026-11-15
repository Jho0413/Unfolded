// The illustration fixture step (E1, issue #152), for /dev/board?scene=image and the tests: a
// 3:2 test picture fitted into a wide box and a tall one, then highlighted, beside an image
// without a `mediaUrl` (never drawn) and one whose picture is broken (hidden).
import type { CueTimes } from "@/shared/lesson";
import { Step } from "@/shared/scene";

/** The dev route's 480 x 320 test picture (./illustration/route.ts). */
export const TEST_PICTURE = "/dev/board/illustration?kind=ok";
export const TEST_PICTURE_ASPECT = 480 / 320;

export const IMAGE_STEP: Step = Step.parse({
  title: "An illustration on the board",
  narration:
    "Picture [[wide]]a sunny hill. The [[tall]]same picture, fitted into a tall box. " +
    "Look [[look]]here. An image [[missing]]with no picture saved, and one [[broken]]that fails.",
  objects: [
    {
      kind: "text",
      id: "title",
      x: 800,
      y: 60,
      text: "Illustrations",
      size: "l",
    },
    {
      kind: "image",
      id: "wide",
      x: 100,
      y: 150,
      w: 800,
      h: 400,
      prompt: "A sunny hill",
      mediaUrl: TEST_PICTURE,
      hidden: true,
    },
    {
      kind: "image",
      id: "tall",
      x: 1000,
      y: 150,
      w: 300,
      h: 500,
      prompt: "A sunny hill, in a tall box",
      mediaUrl: TEST_PICTURE,
      hidden: true,
    },
    {
      kind: "image",
      id: "missing",
      x: 100,
      y: 620,
      w: 300,
      h: 200,
      prompt: "Not saved yet",
      hidden: true,
    },
    {
      kind: "image",
      id: "broken",
      x: 500,
      y: 620,
      w: 300,
      h: 200,
      prompt: "A picture that fails to load",
      mediaUrl: "/dev/board/illustration?kind=broken",
      hidden: true,
    },
  ],
  actions: [
    { cue: "wide", do: "show", target: { id: "wide" }, durationMs: 600 },
    { cue: "tall", do: "show", target: { id: "tall" }, durationMs: 600 },
    { cue: "look", do: "highlight", target: { id: "wide" }, durationMs: 400 },
    { cue: "missing", do: "show", target: { id: "missing" }, durationMs: 600 },
    { cue: "broken", do: "show", target: { id: "broken" }, durationMs: 600 },
  ],
});

/** Cue times (ms) for the dev page and the tests. */
export const IMAGE_CUE_TIMES = {
  wide: 500,
  tall: 2000,
  look: 3500,
  missing: 5000,
  broken: 6000,
} satisfies CueTimes;
