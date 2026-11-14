// Barge-in (qa/bargeIn.ts, issue #93): the learner starting to speak stops the narration once.
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_SPEAKING_CAP_MS,
  AgentTurn,
  BargeIn,
  VAD_HOLD_MS,
  VAD_THRESHOLD,
} from "@/qa/bargeIn";

function setup() {
  let t = 0;
  const onBargeIn = vi.fn();
  const b = new BargeIn(onBargeIn, () => t);
  return { b, onBargeIn, at: (ms: number) => (t = ms) };
}

describe("BargeIn", () => {
  it("fires once the VAD score stays at or above the threshold for VAD_HOLD_MS", () => {
    const { b, onBargeIn, at } = setup();
    b.arm();
    at(0);
    b.vad(VAD_THRESHOLD);
    at(VAD_HOLD_MS - 1);
    b.vad(0.95);
    expect(onBargeIn).not.toHaveBeenCalled();
    at(VAD_HOLD_MS);
    b.vad(0.95);
    expect(onBargeIn).toHaveBeenCalledExactlyOnceWith("vad");
  });

  it("a short spike (a click, a cough) or scores under the threshold don't fire", () => {
    const { b, onBargeIn, at } = setup();
    b.arm();
    at(0);
    b.vad(0.99);
    at(50);
    b.vad(0.3); // the run is broken
    at(100);
    b.vad(0.99);
    at(200);
    b.vad(VAD_THRESHOLD - 0.01);
    at(1000);
    b.vad(0.7);
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it("a learner transcript or the agent starting to speak fires at once", () => {
    const a = setup();
    a.b.arm();
    a.b.transcript("   ");
    expect(a.onBargeIn).not.toHaveBeenCalled();
    a.b.transcript("go back to the first step");
    expect(a.onBargeIn).toHaveBeenCalledExactlyOnceWith("transcript");

    const s = setup();
    s.b.arm();
    s.b.agentSpeaking(false);
    expect(s.onBargeIn).not.toHaveBeenCalled();
    s.b.agentSpeaking(true);
    expect(s.onBargeIn).toHaveBeenCalledExactlyOnceWith("agentSpeaking");
  });

  it("fires once per arming, and never while disarmed", () => {
    const { b, onBargeIn } = setup();
    b.transcript("hello");
    expect(onBargeIn).not.toHaveBeenCalled();
    b.arm();
    b.transcript("hello");
    b.agentSpeaking(true);
    expect(onBargeIn).toHaveBeenCalledOnce();
    expect(b.isArmed).toBe(false);
    b.arm();
    b.disarm();
    b.transcript("hello");
    expect(onBargeIn).toHaveBeenCalledOnce();
  });

  it("re-arming forgets a run of loud frames from before", () => {
    const { b, onBargeIn, at } = setup();
    b.arm();
    at(0);
    b.vad(0.95);
    b.disarm();
    b.arm();
    at(VAD_HOLD_MS);
    b.vad(0.95);
    expect(onBargeIn).not.toHaveBeenCalled();
  });
});

describe("AgentTurn (spoken commands wait for the agent to finish speaking)", () => {
  it("runs at once while the agent is quiet; queued while it speaks, run when it stops", () => {
    const turn = new AgentTurn(() => {});
    const now = vi.fn();
    turn.after(now);
    expect(now).toHaveBeenCalledOnce();
    turn.setSpeaking(true);
    const later = vi.fn();
    turn.after(later);
    expect(later).not.toHaveBeenCalled();
    turn.setSpeaking(false);
    expect(later).toHaveBeenCalledOnce();
    turn.setSpeaking(false);
    expect(later).toHaveBeenCalledOnce();
  });

  it("a lost 'listening' event: run after AGENT_SPEAKING_CAP_MS, once", () => {
    const timers: [() => void, number][] = [];
    const turn = new AgentTurn((fn, ms) => timers.push([fn, ms]));
    turn.setSpeaking(true);
    const fn = vi.fn();
    turn.after(fn);
    expect(timers[0][1]).toBe(AGENT_SPEAKING_CAP_MS);
    timers[0][0]();
    expect(fn).toHaveBeenCalledOnce();
    turn.setSpeaking(false);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("the handler can be set after construction", () => {
    const b = new BargeIn();
    const fn = vi.fn();
    b.setHandler(fn);
    b.arm();
    b.agentSpeaking(true);
    expect(fn).toHaveBeenCalledWith("agentSpeaking");
  });
});
