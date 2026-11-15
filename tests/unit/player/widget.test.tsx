// The "try it yourself" widget in the player (issue #110): one test per row of #110's
// behaviour table that the player decides (widgetOnScreen, driven through the real machine),
// and what the panel renders, a broken curve included. The browser checks are in
// tests/e2e/widget.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FAKE_WIDGETS } from "@/app/dev/player/fakeWidgets";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import {
  initialState,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import { pathThrough } from "@/player/primitives/Plot";
import { WidgetPanel } from "@/player/widget/WidgetPanel";
import { atStepEnd, widgetOnScreen } from "@/player/widget/widgetView";
import { Step } from "@/shared/scene";

const ctx = { stepCount: 2 };
const step = { ...Step.parse(demoM1), widget: FAKE_WIDGETS.plot };
const plain = Step.parse(demoM1);

/** Runs events from the start; each must change the state. */
function run(...events: PlayerEvent[]): PlayerState {
  let state = initialState().state;
  for (const e of events) {
    const r = transition(state, e, ctx);
    if (r.outcome !== "changed")
      throw new Error(`${e.type} in ${state.kind}: ${r.outcome}`);
    state = r.state;
  }
  return state;
}
const playing = () => run({ type: "stepReady", i: 0 });
const ended = () => run({ type: "stepReady", i: 0 }, { type: "audioEnded" });

describe("widget rows of #110's behaviour table", () => {
  it("step playing + narration ends: the widget panel appears (with its prompt)", () => {
    expect(widgetOnScreen(playing(), step)).toBeNull();
    expect(widgetOnScreen(ended(), step)).toBe(step.widget);
  });

  it("the learner replays: hidden while replaying, back at the end", () => {
    const replaying = transition(ended(), { type: "replay" }, ctx).state;
    expect(replaying.kind).toBe("playing");
    expect(widgetOnScreen(replaying, step)).toBeNull();
    const again = transition(replaying, { type: "audioEnded" }, ctx).state;
    expect(widgetOnScreen(again, step)).toBe(step.widget);
  });

  it("paused partway (holding on) is not the end: no widget", () => {
    const paused = transition(playing(), { type: "pause" }, ctx).state;
    expect(widgetOnScreen(paused, step)).toBeNull();
  });

  it("widget shown + Next / go_to_step: the widget goes away", () => {
    const next = transition(ended(), { type: "next" }, ctx).state;
    expect(next.kind).toBe("loading");
    expect(widgetOnScreen(next, step)).toBeNull();
    const jump = transition(ended(), { type: "goToStep", n: 1 }, ctx).state;
    expect(widgetOnScreen(jump, step)).toBeNull();
  });

  it("widget shown + Ask opens: the widget stays", () => {
    const asking = transition(ended(), { type: "ask" }, ctx).state;
    expect(asking.kind).toBe("asking");
    expect(widgetOnScreen(asking, step)).toBe(step.widget);
    // Ask opened while the step was still playing: not the end, no widget.
    const midAsk = transition(playing(), { type: "ask" }, ctx).state;
    expect(widgetOnScreen(midAsk, step)).toBeNull();
  });

  it("after the last step (finished) the last step's widget is still there", () => {
    const finished: PlayerState = { kind: "finished", step: 1 };
    expect(atStepEnd(finished)).toBe(true);
    expect(widgetOnScreen(finished, step)).toBe(step.widget);
  });

  it("step without widget + narration ends: nothing new", () => {
    expect(widgetOnScreen(ended(), plain)).toBeNull();
    expect(widgetOnScreen(ended(), undefined)).toBeNull();
  });
});

describe("the panel", () => {
  it("a plot widget: its sliders, labelled and showing their values, and the curve", () => {
    const html = renderToStaticMarkup(
      <WidgetPanel widget={FAKE_WIDGETS.plot} />,
    );
    expect(html).toContain('data-testid="widget-panel"');
    expect(html).toContain('data-kind="plot"');
    expect(html).toContain('type="range"');
    expect(html).toContain("Height a");
    expect(html).toContain('data-testid="value-a"');
    expect(html).toContain(`data-finite-points="160"`);
    expect(html).toMatch(
      /aria-expanded="true" aria-controls="([^"]+)"[\s\S]*id="\1"/,
    );
  });

  it("a heatmap widget: an input per score, the temperature slider, and the softmax view", () => {
    const html = renderToStaticMarkup(
      <WidgetPanel widget={FAKE_WIDGETS.heatmap} />,
    );
    expect(html.match(/type="number"/g)).toHaveLength(9);
    expect(html).toContain('aria-label="Score, The, cat"');
    expect(html).toContain("Temperature");
    expect(html).toContain('data-kind="heatmap"');
    expect(html).toContain('data-value="0.66"');
  });

  it("a huge but finite y is held near the axes, so the path stays drawable", () => {
    const widget = {
      ...FAKE_WIDGETS.plot,
      expr: "exp(70 * x)",
      params: [],
    } as typeof FAKE_WIDGETS.plot;
    const html = renderToStaticMarkup(<WidgetPanel widget={widget} />);
    expect(html).not.toMatch(/e\+\d{3}/);
  });

  it("expr evaluates to NaN/Infinity at a point: the curve breaks there, no crash", () => {
    const widget = {
      ...FAKE_WIDGETS.plot,
      expr: "sqrt(x)",
      y: [0, 2],
    } as typeof FAKE_WIDGETS.plot;
    const html = renderToStaticMarkup(<WidgetPanel widget={widget} />);
    expect(html).toContain("data-finite-points=");
    expect(html).not.toContain("NaN");
    expect(
      pathThrough([
        { x: 0, y: 0 },
        { x: 1, y: NaN },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 4, y: Infinity },
      ]),
    ).toBe("M 0 0 M 2 1 L 3 2");
  });
});
