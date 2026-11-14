"use client";
import { useState } from "react";
import { Player } from "@/player/Player";
import { FAKE_STEP_COUNT, type FakeOptions, fakeFetchStep } from "./fakeLesson";

export function DevPlayer({ options }: { options: FakeOptions }) {
  // One fake lesson per page load, so its attempt counts survive re-renders.
  const [fetchStep] = useState(() => fakeFetchStep(options));
  return (
    <Player
      stepCount={FAKE_STEP_COUNT}
      fetchStep={fetchStep}
      debug={options.debug}
    />
  );
}
