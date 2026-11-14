// Replay mode on the step route (ROADMAP L3, ARCHITECTURE.md section 5.5): with REPLAY_RUN set
// the lesson page still plays a saved run, now through POST /api/lessons/<id>/steps/<n>, which
// serves saved steps only; a step that isn't in the run fails with "This step isn't in the
// saved run.", every time. REPLAY_RUN is read when the server starts, so this file starts its
// own server from the same build, on a free port, beside the fake-mode one.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { STEP_NOT_IN_RUN } from "@/shared/lesson";
import { E2E_RUNS_DIR_NAME } from "./support/runsDir";
import { savedRun, savedStepTitle } from "./support/savedRun";

const LESSON = "e2e-replay-run";

/** A port nothing listens on now (other worktrees may run their own servers). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

let base = "";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});
test.describe.configure({ mode: "serial" });

let run: Awaited<ReturnType<typeof savedRun>>;
let server: ChildProcess;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  // Saved before the server starts: REPLAY_RUN must name a folder that exists.
  run = await savedRun(LESSON, { steps: 2, unsaved: [1] });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REPLAY_RUN: LESSON,
    RUNS_DIR: E2E_RUNS_DIR_NAME,
  };
  delete env.FAKE_APIS;
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn("npx", ["next", "start", "-p", String(port)], {
    env,
    stdio: "ignore",
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${base}/lesson/${LESSON}`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 50_000 },
    )
    .toBe(200);
});

test.afterAll(async () => {
  server?.kill();
  await run?.[Symbol.asyncDispose]();
});

async function expectState(page: Page, state: string, step: number) {
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", state);
  await expect(player).toHaveAttribute("data-step", String(step));
}

test("replay: a saved step plays through the step route; one not in the run fails with its message", async ({
  page,
}) => {
  const steps: string[] = [];
  page.on("response", (res) => {
    const { pathname } = new URL(res.url());
    if (pathname.startsWith(`/api/lessons/${LESSON}/steps/`))
      steps.push(`${pathname.split("/").at(-1)} ${res.status()}`);
  });
  await page.goto(`${base}/lesson/${LESSON}`);
  await expect(page.getByTestId("lesson")).toHaveAttribute("data-replay", "1");
  await expectState(page, "playing", 0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(0),
  );
  // Step 1's prefetch: not in the run.
  await expect.poll(() => steps).toEqual(["0 200", "1 404"]);

  await page.getByTestId("player-audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = Math.max(0, audio.duration - 0.1);
  });
  await expectState(page, "stepEnded", 0);
  await page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expectState(page, "failed", 1);
  await expect(page.getByTestId("player-error")).toHaveText(STEP_NOT_IN_RUN);
  // The failed prefetch was forgotten, so Next asked again.
  expect(steps).toEqual(["0 200", "1 404", "1 404"]);
});
