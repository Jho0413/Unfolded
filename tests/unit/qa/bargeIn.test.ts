// Barge-in (qa/bargeIn.ts, issue #93): the learner starting to speak stops the narration once.
import { describe, expect, it, vi } from "vitest";
import {
  ACK_WAIT_MS,
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

  it("after a command (QA A2): the agent speaking about it doesn't fire, until the learner's next turn", () => {
    const { b, onBargeIn, at } = setup();
    b.quietAgent(); // resume_lesson ran (Ask closing), then the panel re-arms
    b.arm();
    at(3000); // the agent's "Sure." starts well after ACK_WAIT_MS
    b.agentSpeaking(true);
    b.agentSpeaking(false);
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(b.isArmed).toBe(true);
    // The learner's own voice still counts at once.
    b.vad(0.95);
    at(3000 + VAD_HOLD_MS);
    b.vad(0.95);
    expect(onBargeIn).toHaveBeenCalledExactlyOnceWith("vad");
  });

  it("after a command, the learner's next transcript fires and ends the quiet", () => {
    const { b, onBargeIn } = setup();
    b.quietAgent();
    b.arm();
    b.transcript(" ");
    b.agentSpeaking(true);
    expect(onBargeIn).not.toHaveBeenCalled(); // empty transcripts are noise, still quiet
    b.transcript("wait, what's a logit?");
    expect(onBargeIn).toHaveBeenCalledExactlyOnceWith("transcript");
    b.arm();
    b.agentSpeaking(true);
    expect(onBargeIn).toHaveBeenLastCalledWith("agentSpeaking");
    expect(onBargeIn).toHaveBeenCalledTimes(2);
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
  function timed() {
    const timers: [() => void, number][] = [];
    const turn = new AgentTurn((fn, ms) => timers.push([fn, ms]));
    const fire = (ms: number) =>
      timers.filter(([, m]) => m === ms).forEach(([fn]) => fn());
    return { turn, timers, fire };
  }

  it("queued while the agent speaks, run when it stops, once", () => {
    const { turn } = timed();
    turn.setSpeaking(true);
    const fn = vi.fn();
    turn.after(fn);
    expect(fn).not.toHaveBeenCalled();
    turn.setSpeaking(false);
    expect(fn).toHaveBeenCalledOnce();
    turn.setSpeaking(false);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("tool first, 'Sure.' after: waits for the agent's acknowledgement to end", () => {
    const { turn, fire } = timed();
    const fn = vi.fn();
    turn.after(fn);
    expect(fn).not.toHaveBeenCalled();
    turn.setSpeaking(true);
    fire(ACK_WAIT_MS); // still speaking: keeps waiting
    expect(fn).not.toHaveBeenCalled();
    turn.setSpeaking(false);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("the agent stays quiet: runs after ACK_WAIT_MS", () => {
    const { turn, fire } = timed();
    const fn = vi.fn();
    turn.after(fn);
    fire(ACK_WAIT_MS);
    expect(fn).toHaveBeenCalledOnce();
    fire(AGENT_SPEAKING_CAP_MS);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("a lost 'listening' event: run after AGENT_SPEAKING_CAP_MS, once", () => {
    const { turn, fire } = timed();
    turn.setSpeaking(true);
    const fn = vi.fn();
    turn.after(fn);
    fire(AGENT_SPEAKING_CAP_MS);
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
