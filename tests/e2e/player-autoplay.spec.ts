// A blocked autoplay (ARCHITECTURE.md sections 6.1 and 7): the browser
// refuses audio.play() without a user gesture, as after a page reload.
// Chromium's own policy can't be relied on here: Playwright's navigations
// already count as a user activation, so the page gets that policy
// emulated instead. play() rejects with the browser's NotAllowedError until
// the first real (trusted) click or key press.
import { expect, test } from "@playwright/test";
import { MESSAGES } from "@/player/machine";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let gesture = false;
    for (const type of ["pointerdown", "keydown"])
      window.addEventListener(
        type,
        (e) => {
          if (e.isTrusted) gesture = true;
        },
        { capture: true },
      );
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!gesture)
        return Promise.reject(
          new DOMException("play() needs a user gesture", "NotAllowedError"),
        );
      return play.call(this);
    };
  });
});

test("playing + playBlocked: → paused, with Press play to start", async ({
  page,
}) => {
  await page.goto("/dev/player");
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "paused");
  await expect(player).toHaveAttribute("data-step", "0");
  await expect(page.getByTestId("player-notice")).toHaveText(
    MESSAGES.pressPlay,
  );

  // Recovery (section 7): the Play button.
  await page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect(player).toHaveAttribute("data-state", "playing");
  await expect(page.getByTestId("player-notice")).toHaveCount(0);
});

test("paused + audioError: ignored, then Play → failed (Couldn't play the audio. Retry?)", async ({
  page,
}) => {
  await page.goto("/dev/player?audio=broken");
  const player = page.getByTestId("player");
  // Blocked, so paused: the decode error that follows is ignored there.
  await expect(player).toHaveAttribute("data-state", "paused");
  await page
    .getByTestId("player-audio")
    .evaluate(
      (audio: HTMLAudioElement) =>
        audio.error !== null ||
        new Promise<boolean>((resolve) =>
          audio.addEventListener("error", () => resolve(true), { once: true }),
        ),
    );
  await expect(player).toHaveAttribute("data-state", "paused");

  await page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await expect(player).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("player-error")).toHaveText(
    MESSAGES.audioFailed,
  );
});
