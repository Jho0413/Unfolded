// A narrated answer's playback (#105): one test per row of the issue's table that the pure
// decision owns (app/lesson/[lessonId]/AnswerViewPlayback.ts), every other cell of the
// state x event grid as "ignored", and the controller that plays it
// (app/lesson/[lessonId]/AnswerViewAudio.ts) with a fake audio element.
import { describe, expect, it, vi } from "vitest";
import { createAnswerPlayer } from "@/app/lesson/[lessonId]/AnswerViewAudio";
import {
  type AnswerEvent,
  type AnswerPlayback,
  answerCommand,
  answerTransition,
} from "@/app/lesson/[lessonId]/AnswerViewPlayback";

describe("answerTransition: the table's rows", () => {
  it("playing x narration ends: done, the drawing complete", () => {
    expect(answerTransition("playing", "ended")).toEqual({
      to: "done",
      clock: "end",
    });
  });

  it("playing x the learner speaks (barge-in): paused, the drawing holds at its moment", () => {
    expect(answerTransition("playing", "learnerSpoke")).toEqual({
      to: "paused",
      clock: "here",
    });
  });

  it("paused x carry on / go on: playing from the same moment", () => {
    expect(answerTransition("paused", "resume")).toEqual({
      to: "playing",
      clock: "here",
    });
  });

  it("paused or done x say that again: playing from 0, the drawing reset", () => {
    for (const state of ["paused", "done"] as const)
      expect(answerTransition(state, "replay")).toEqual({
        to: "playing",
        clock: "start",
      });
  });

  it("playing x audio fails to load or play: done, the whole drawing at once", () => {
    expect(answerTransition("playing", "audioFailed")).toEqual({
      to: "done",
      clock: "end",
    });
  });
});

describe("answerTransition: every other cell", () => {
  const cells: [AnswerPlayback, AnswerEvent, string][] = [
    ["paused", "ended", "a paused narration doesn't end"],
    ["done", "ended", "already over"],
    ["paused", "learnerSpoke", "already held"],
    ["done", "learnerSpoke", "nothing playing to hold"],
    ["playing", "resume", "already playing"],
    ["done", "resume", "over: carry on is the lesson's (answerCommand)"],
    ["done", "audioFailed", "already showing whole"],
  ];
  for (const [state, event, why] of cells)
    it(`${state} x ${event}: ignored (${why})`, () => {
      expect(answerTransition(state, event)).toBeNull();
    });

  it("playing x say that again: from 0 too", () => {
    expect(answerTransition("playing", "replay")).toEqual({
      to: "playing",
      clock: "start",
    });
  });

  it("paused x audio fails (on resume): done", () => {
    expect(answerTransition("paused", "audioFailed")?.to).toBe("done");
  });
});

describe("answerCommand: spoken commands while the Answer view is up", () => {
  it("paused x carry on: the answer goes on", () => {
    expect(answerCommand("paused", "resume")).toBe("resume");
  });

  it("done x carry on: the lesson's (Ask closes, the lesson goes on)", () => {
    expect(answerCommand("done", "resume")).toBeNull();
  });

  it("paused or done x say that again: the answer again, not the step", () => {
    expect(answerCommand("paused", "replay")).toBe("replay");
    expect(answerCommand("done", "replay")).toBe("replay");
  });

  it("go back, next, previous: the lesson's (Ask closes, #94's closing rules)", () => {
    for (const command of ["pause", "next", "previous"] as const)
      expect(answerCommand("paused", command)).toBeNull();
  });

  it("no answer playing: every command is the lesson's", () => {
    expect(answerCommand(null, "replay")).toBeNull();
    expect(answerCommand(null, "resume")).toBeNull();
  });
});

/** A fake audio element: play and pause are recorded, `ended` and `error` fired by the test. */
function fakeAudio(play: () => Promise<void> = async () => {}) {
  const listeners = new Map<string, () => void>();
  const audio = {
    currentTime: 0,
    play: vi.fn(play),
    pause: vi.fn(),
    addEventListener: vi.fn((type: string, fn: () => void) =>
      listeners.set(type, fn),
    ),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    fire: (type: string) => listeners.get(type)?.(),
  };
  return audio;
}

function player(play?: () => Promise<void>) {
  const audio = fakeAudio(play);
  const revokeUrl = vi.fn();
  const warn = vi.fn();
  const answers = createAnswerPlayer({
    createAudio: () => audio as unknown as HTMLAudioElement,
    createUrl: () => "blob:answer",
    revokeUrl,
    log: { warn },
  });
  return { answers, audio, revokeUrl, warn };
}

const BLOB = new Blob([new Uint8Array([1])]);

describe("the answer player (AnswerViewAudio)", () => {
  it("preparing x answer + audio arrive: playing from 0, the clock the audio's time", () => {
    const { answers, audio } = player();
    void answers.play(BLOB);
    expect(answers.state()).toBe("playing");
    expect(audio.play).toHaveBeenCalledOnce();
    audio.currentTime = 1.25;
    expect(answers.clockMs()).toBe(1250);
  });

  it("playing x narration ends: done, the whole drawing (clock past every action), resolves shown", async () => {
    const { answers, audio } = player();
    const outcome = answers.play(BLOB);
    audio.fire("ended");
    expect(answers.state()).toBe("done");
    expect(answers.clockMs()).toBe(Infinity);
    await expect(outcome).resolves.toEqual({ kind: "shown" });
  });

  it("playing x the learner speaks: paused where it was, resolves paused at that moment", async () => {
    const { answers, audio } = player();
    const outcome = answers.play(BLOB);
    audio.currentTime = 2;
    expect(answers.send("learnerSpoke")).toBe(true);
    expect(answers.state()).toBe("paused");
    expect(audio.pause).toHaveBeenCalled();
    expect(answers.clockMs()).toBe(2000);
    await expect(outcome).resolves.toEqual({ kind: "paused", tMs: 2000 });
  });

  it("paused x carry on: playing from the same moment", () => {
    const { answers, audio } = player();
    void answers.play(BLOB);
    audio.currentTime = 2;
    answers.send("learnerSpoke");
    expect(answers.send("resume")).toBe(true);
    expect(answers.state()).toBe("playing");
    expect(audio.currentTime).toBe(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("paused or done x say that again: playing from 0, the drawing reset", () => {
    for (const end of ["learnerSpoke", "ended"] as const) {
      const { answers, audio } = player();
      void answers.play(BLOB);
      audio.currentTime = 3;
      if (end === "ended") audio.fire("ended");
      else answers.send(end);
      expect(answers.send("replay")).toBe(true);
      expect(answers.state()).toBe("playing");
      expect(audio.currentTime).toBe(0);
      expect(answers.clockMs()).toBe(0);
    }
  });

  it("playing x audio fails to play: done with the full drawing, and a log line", async () => {
    const { answers, warn } = player(() =>
      Promise.reject(new DOMException("no", "NotSupportedError")),
    );
    const outcome = answers.play(BLOB);
    await expect(outcome).resolves.toEqual({ kind: "shown" });
    expect(answers.state()).toBe("done");
    expect(answers.clockMs()).toBe(Infinity);
    expect(warn).toHaveBeenCalled();
  });

  it("a barge-in right after play (the play aborted): stays paused, not an audio failure", async () => {
    let abort: (err: unknown) => void = () => {};
    const { answers, warn } = player(
      () => new Promise<void>((_resolve, reject) => (abort = reject)),
    );
    const outcome = answers.play(BLOB);
    answers.send("learnerSpoke");
    abort(new DOMException("interrupted by pause()", "AbortError"));
    await expect(outcome).resolves.toMatchObject({ kind: "paused" });
    await Promise.resolve();
    expect(answers.state()).toBe("paused");
    expect(warn).not.toHaveBeenCalled();
    // So "carry on" still goes on with the answer.
    expect(answers.send("resume")).toBe(true);
  });

  it("a play that fails after a pause: ignored, the answer stays held", async () => {
    let fail: (err: unknown) => void = () => {};
    const { answers } = player(
      () => new Promise<void>((_resolve, reject) => (fail = reject)),
    );
    void answers.play(BLOB);
    answers.send("learnerSpoke");
    fail(new DOMException("no", "NotSupportedError"));
    await Promise.resolve();
    expect(answers.state()).toBe("paused");
  });

  it("playing x the audio element errors: done with the full drawing", async () => {
    const { answers, audio } = player();
    const outcome = answers.play(BLOB);
    audio.fire("error");
    expect(answers.state()).toBe("done");
    await expect(outcome).resolves.toEqual({ kind: "shown" });
  });

  it("audio that failed to load (null): shown whole at once, with a log line", async () => {
    const { answers, warn } = player();
    await expect(answers.play(null)).resolves.toEqual({ kind: "shown" });
    expect(answers.state()).toBe("done");
    expect(answers.clockMs()).toBe(Infinity);
    expect(warn).toHaveBeenCalled();
    // Say that again can't play it either: it stays whole.
    answers.send("replay");
    expect(answers.state()).toBe("done");
  });

  it("any x Ask closes: stopped, its audio paused and freed, resolves left", async () => {
    const { answers, audio, revokeUrl } = player();
    const outcome = answers.play(BLOB);
    answers.stop();
    expect(answers.state()).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith("blob:answer");
    await expect(outcome).resolves.toEqual({ kind: "left" });
    // A late "ended" from the old element changes nothing.
    audio.fire("ended");
    expect(answers.state()).toBeNull();
  });

  it("a newer answer replaces a playing one: the old one resolves left", async () => {
    const { answers } = player();
    const first = answers.play(BLOB);
    void answers.play(BLOB);
    await expect(first).resolves.toEqual({ kind: "left" });
    expect(answers.state()).toBe("playing");
  });

  it("only the first playback resolves: a replay that ends later doesn't resolve again", async () => {
    const { answers, audio } = player();
    const outcome = answers.play(BLOB);
    answers.send("learnerSpoke");
    await expect(outcome).resolves.toMatchObject({ kind: "paused" });
    answers.send("replay");
    audio.fire("ended");
    expect(answers.state()).toBe("done");
  });

  it("with no answer: the clock is 0 and events are ignored", () => {
    const { answers } = player();
    expect(answers.clockMs()).toBe(0);
    expect(answers.send("resume")).toBe(false);
  });
});
