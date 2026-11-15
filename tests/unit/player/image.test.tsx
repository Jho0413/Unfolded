// player/primitives/Image.tsx (E1, issue #152): the fit math, that an image without a
// `mediaUrl` draws nothing, and that one with it waits hidden for its picture. The loaded and
// broken pictures are checked in a browser by tests/e2e/image.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  IMAGE_CUE_TIMES,
  IMAGE_STEP,
  TEST_PICTURE,
} from "@/app/dev/board/imageStep";
import { sceneState } from "@/app/dev/board/scenes";
import { Whiteboard } from "@/player/Whiteboard";
import { BoardImage, fitBox } from "@/player/primitives/Image";
import { type ImageObject, ImageObject as ImageSchema } from "@/shared/scene";

const BOX = { x: 100, y: 50, w: 800, h: 400 };

describe("fitBox", () => {
  it("fits a narrower picture to the box's height, centred across", () => {
    expect(fitBox(BOX, 1.5)).toEqual({ x: 200, y: 50, w: 600, h: 400 });
  });
  it("fits a wider picture to the box's width, centred down", () => {
    expect(fitBox(BOX, 4)).toEqual({ x: 100, y: 150, w: 800, h: 200 });
  });
  it("fills a box of the same aspect", () => {
    expect(fitBox(BOX, 2)).toEqual(BOX);
  });
  it("always stays inside the box and keeps the aspect", () => {
    for (const aspect of [0.1, 0.5, 1, 1.5, 3, 10]) {
      const fit = fitBox(BOX, aspect);
      expect(fit.x).toBeGreaterThanOrEqual(BOX.x);
      expect(fit.y).toBeGreaterThanOrEqual(BOX.y);
      expect(fit.x + fit.w).toBeLessThanOrEqual(BOX.x + BOX.w + 1e-9);
      expect(fit.y + fit.h).toBeLessThanOrEqual(BOX.y + BOX.h + 1e-9);
      expect(fit.w / fit.h).toBeCloseTo(aspect);
      // One side touches the box.
      expect(fit.w === BOX.w || fit.h === BOX.h).toBe(true);
    }
  });
  it("fills the box for a bad aspect", () => {
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(fitBox(BOX, aspect)).toEqual(BOX);
  });
});

const image = (over: Partial<ImageObject> = {}): ImageObject => ({
  kind: "image",
  id: "pic",
  x: 100,
  y: 100,
  w: 400,
  h: 300,
  prompt: "A sunny hill",
  ...over,
});

const render = (img: ImageObject, visible = true) =>
  renderToStaticMarkup(
    <svg>
      <BoardImage
        image={img}
        state={{ object: img, visible, highlight: null }}
        active={[]}
      />
    </svg>,
  );

describe("Image", () => {
  it("draws nothing without a mediaUrl", () => {
    expect(render(image())).toBe("<svg></svg>");
  });
  it("waits hidden, with no <image>, until its picture has loaded", () => {
    const html = render(image({ mediaUrl: TEST_PICTURE }));
    expect(html).toContain('data-kind="image"');
    expect(html).toContain('data-status="loading"');
    expect(html).toContain('visibility="hidden"');
    expect(html).not.toContain("<image");
  });
  it("is drawn by the whiteboard only when it has a mediaUrl", () => {
    const html = renderToStaticMarkup(
      <Whiteboard state={sceneState("image", IMAGE_CUE_TIMES.broken + 1000)} />,
    );
    for (const id of ["wide", "tall", "broken"])
      expect(html).toContain(`data-object-id="${id}"`);
    expect(html).not.toContain('data-object-id="missing"');
  });
});

describe("ImageObject", () => {
  it("takes an optional mediaUrl", () => {
    expect(ImageSchema.parse(image()).mediaUrl).toBeUndefined();
    expect(ImageSchema.parse(image({ mediaUrl: "/x.jpg" })).mediaUrl).toBe(
      "/x.jpg",
    );
  });
  it("the fixture step parses", () => {
    expect(IMAGE_STEP.objects.filter((o) => o.kind === "image")).toHaveLength(
      4,
    );
  });
});
