// How objects arrive on the board (issue #101, player/primitives/motion.ts): draw-on, rise,
// stagger and the highlight pulse, all computed from sceneAt's progress. So a frame depends on
// t alone: a seek lands on exactly the frame playing would have shown, a draw-on half done
// included. Reduced motion is CSS (board.css): the markup carries the classes and the quick
// fade it switches to; tests/e2e/board.spec.ts checks it in a browser.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Whiteboard } from "@/player/Whiteboard";
import { sceneAt, type TimedAction } from "@/player/sceneAt";
import { easeInOutCubic, easeOutCubic, span } from "@/player/easing";
import {
  QUICK_FADE,
  RISE_PX,
  appearance,
  drawOnProps,
  highlightLook,
  motionProps,
  showProgress,
  staggerIn,
} from "@/player/primitives/motion";
import type { Action, ActiveAction, BoardObject } from "@/shared/scene";

const show = (id: string, progress: number): ActiveAction => ({
  action: { do: "show", target: { id }, durationMs: 400 },
  progress,
});
const hide = (id: string, progress: number): ActiveAction => ({
  action: { do: "hide", target: { id }, durationMs: 400 },
  progress,
});

describe("easing", () => {
  it("starts at 0, ends at 1, and clamps outside", () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(-1)).toBe(0);
      expect(ease(2)).toBe(1);
    }
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });
  it("span maps a sub-span of 0..1", () => {
    expect(span(0.1, 0.2, 0.4)).toBe(0);
    expect(span(0.4, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(span(0.9, 0.2, 0.4)).toBe(1);
    expect(span(1, 0.8, 0.2)).toBe(1); // not 0.9999999999999998
  });
});

describe("appearance", () => {
  it("a stroke draws on with the show's eased progress, its ink visible almost at once", () => {
    expect(appearance([show("m", 0)], { id: "m" }, true, "stroke")).toEqual({
      opacity: 0,
      draw: 0,
      enter: 0,
      rise: 0,
      quick: 0,
    });
    const mid = appearance([show("m", 0.5)], { id: "m" }, true, "stroke");
    expect(mid.draw).toBe(0.875);
    expect(mid.opacity).toBe(1);
    const done = appearance([], { id: "m" }, true, "stroke");
    expect(done).toEqual({ opacity: 1, draw: 1, enter: 1, rise: 0 });
  });

  it("text rises RISE_PX and fades in, eased", () => {
    const start = appearance([show("t", 0)], { id: "t" }, true, "text");
    expect(start).toMatchObject({ opacity: 0, draw: 1, rise: RISE_PX });
    const mid = appearance([show("t", 0.5)], { id: "t" }, true, "text");
    expect(mid.opacity).toBe(0.875);
    expect(mid.rise).toBeCloseTo(RISE_PX * 0.125);
  });

  it("while shown, `quick` is the reduced-motion fade, done in QUICK_FADE", () => {
    for (const kind of ["stroke", "text"] as const) {
      const at = (p: number) =>
        appearance([show("x", p)], { id: "x" }, true, kind).quick;
      expect(at(QUICK_FADE / 2)).toBe(0.5);
      expect(at(QUICK_FADE)).toBe(1);
    }
  });

  it("a hide fades out as before (fadeOpacity); hidden objects are invisible", () => {
    expect(appearance([hide("x", 0.25)], { id: "x" }, true, "stroke")).toEqual({
      opacity: 0.75,
      draw: 1,
      enter: 1,
      rise: 0,
    });
    expect(
      showProgress([show("x", 0.5), hide("x", 0.2)], { id: "x" }),
    ).toBeUndefined();
    expect(appearance([], { id: "x" }, false, "text").opacity).toBe(0);
  });
});

describe("drawOnProps and motionProps", () => {
  it("dashes the path to the drawn share of its normalised length; none once drawn", () => {
    expect(drawOnProps(0)).toEqual({
      className: "wb-draw",
      pathLength: 1,
      strokeDasharray: "1 1",
      strokeDashoffset: 1,
    });
    expect(drawOnProps(0.25).strokeDashoffset).toBe(0.75);
    expect(drawOnProps(1)).toEqual({});
  });

  it("marks what is fading in or rising for reduced motion; nothing when settled", () => {
    expect(motionProps({ quick: 0.5, rise: 3 })).toEqual({
      className: "wb-quick wb-rise",
      style: { "--wb-quick": "0.5" },
    });
    expect(motionProps({ quick: 1 }, "wb-glow", { "--hl": "red" })).toEqual({
      className: "wb-glow wb-quick",
      style: { "--hl": "red", "--wb-quick": "1" },
    });
    expect(motionProps({ rise: 0 })).toEqual({});
  });
});

describe("staggerIn and highlightLook", () => {
  it("cells fill in reading order behind the pen", () => {
    expect(staggerIn(0.3, 0, 4)).toBeGreaterThan(staggerIn(0.3, 3, 4));
    expect(staggerIn(0.1, 0, 4)).toBe(0);
    expect(staggerIn(1, 3, 4)).toBe(1);
  });

  it("a highlight pulses once: none at the start, the peak halfway, settled at the end", () => {
    expect(highlightLook(0)).toEqual({ opacity: 0, pulse: 0, quick: 0 });
    expect(highlightLook(0.5).pulse).toBe(1);
    expect(highlightLook(0.5).quick).toBe(1);
    expect(highlightLook(1)).toEqual({ opacity: 1, pulse: 0 });
  });
});

// ---------------------------------------------------------------- rendered over time

const objects: BoardObject[] = [
  {
    kind: "matrix",
    id: "m",
    x: 300,
    y: 300,
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
    hidden: true,
  },
  { kind: "text", id: "t", x: 900, y: 300, text: "hello", hidden: true },
  { kind: "arrow", id: "a", from: { id: "m" }, to: { id: "t" }, hidden: true },
];
const at = (startMs: number, action: Action): TimedAction => ({
  action,
  startMs,
  durationMs: action.durationMs,
});
const timed: TimedAction[] = [
  at(1000, { do: "show", target: { id: "m" }, durationMs: 400 }),
  at(1000, { do: "show", target: { id: "t" }, durationMs: 400 }),
  at(2000, { do: "show", target: { id: "a" }, durationMs: 400 }),
  at(3000, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 400 }),
];

function frame(tMs: number): string {
  return renderToStaticMarkup(
    <Whiteboard state={sceneAt(objects, timed, tMs)} />,
  );
}
const attr = (html: string, id: string, name: string) =>
  html.match(new RegExp(`data-object-id="${id}"[^>]*${name}="([^"]+)"`))?.[1];
/** The matrix's bracket paths' dash offsets. */
const bracketOffsets = (html: string) =>
  [
    ...(html.match(/data-brackets[^]*?<\/g>/)?.[0] ?? "").matchAll(
      /stroke-dashoffset="([^"]+)"/g,
    ),
  ].map((m) => Number(m[1]));

describe("the board over time (draw-on from t)", () => {
  it("t = 0 (before the show): hidden, nothing drawn", () => {
    expect(attr(frame(0), "m", "data-visible")).toBe("false");
  });

  it("at the show's cue: the brackets start undrawn", () => {
    const html = frame(1000);
    expect(attr(html, "m", "data-draw")).toBe("0");
    expect(bracketOffsets(html)).toEqual([1, 1]);
  });

  it("mid-show: drawn to the eased progress, text rising", () => {
    const html = frame(1200); // progress 0.5, eased 0.875
    expect(attr(html, "m", "data-draw")).toBe("0.88");
    expect(bracketOffsets(html)).toEqual([0.125, 0.125]);
    expect(html).toMatch(
      /data-object-id="t"[^>]*transform="translate\(0 1\.25\)"/,
    );
    // The logical progress attributes are unchanged.
    expect(attr(html, "m", "data-opacity")).toBe("0.5");
  });

  it("after the show: fully drawn, no dash, no rise", () => {
    const html = frame(1400);
    expect(attr(html, "m", "data-draw")).toBe("1");
    expect(bracketOffsets(html)).toEqual([]);
    expect(html).not.toMatch(/data-object-id="t"[^>]*transform=/);
  });

  it("the arrow draws from its tail; its head lands at the end", () => {
    const html = frame(2100); // progress 0.25
    expect(attr(html, "a", "data-draw")).toBe(
      String(Math.round(easeOutCubic(0.25) * 100) / 100),
    );
    expect(html).toMatch(/<line [^>]*stroke-dashoffset="0\.421875"/);
    expect(html).toMatch(/<polygon [^>]*opacity="0"/);
  });

  it("a seek gives exactly the frame playing would: back to a draw-on half done", () => {
    // Play through in 100 ms frames, then seek back: the frame at t is the one playing showed.
    const played = new Map<number, string>();
    for (let t = 0; t <= 5000; t += 100) played.set(t, frame(t));
    for (const t of [1200, 2100, 1000, 3200])
      expect(frame(t)).toBe(played.get(t));
    expect(bracketOffsets(frame(1200))).toEqual([0.125, 0.125]);
  });

  it("a highlight pulses once, then settles", () => {
    expect(frame(3200)).toMatch(/data-pulse="1"/);
    expect(frame(3400)).not.toMatch(/data-pulse/);
  });

  it("reduced motion: what moves is marked for board.css, with its quick fade from t", () => {
    const html = frame(1100); // a quarter into the shows
    expect(html).toMatch(/<path class="wb-draw"/);
    expect(html).toMatch(
      /data-object-id="m"[^>]*class="wb-quick" style="--wb-quick:1"/,
    );
    expect(html).toMatch(
      /data-object-id="t"[^>]*class="wb-quick wb-rise" style="--wb-quick:1"/,
    );
    expect(html).toMatch(/class="wb-stagger"/);
    expect(frame(3200)).toMatch(/class="wb-pulse"/);
    expect(frame(1050)).toMatch(/--wb-quick:0.5/);
    // Settled: nothing marked.
    expect(frame(5000)).not.toMatch(
      /wb-quick|wb-draw|wb-rise|wb-stagger|wb-pulse/,
    );
  });

  it("board.css switches the marks off under prefers-reduced-motion", () => {
    const css = readFileSync("player/primitives/board.css", "utf8");
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.wb-draw\s*\{[^}]*stroke-dasharray:\s*none/);
    expect(reduced).toMatch(/\.wb-rise\s*\{[^}]*transform:\s*none/);
    expect(reduced).toMatch(/\.wb-pulse\s*\{[^}]*display:\s*none/);
    expect(reduced).toMatch(/\.wb-stagger\s*\{[^}]*opacity:\s*1 !important/);
    expect(reduced).toMatch(
      /\.wb-quick\s*\{[^}]*opacity:\s*var\(--wb-quick\) !important/,
    );
  });
});
