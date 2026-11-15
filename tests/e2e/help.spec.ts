// The help overlay (#131) on the lesson page: `?` or the top bar's button opens it, it lists
// the keys and the spoken commands (from the sources the handlers use: unit tests in
// tests/unit/player/help.test.tsx), keys inside it don't reach the lesson, and Escape closes
// it without closing Ask. At 1440 and 390 px, light and dark; screenshots go to evidence/131/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { SHORTCUTS, shortcutHintLines } from "@/player/controls";
import { SPOKEN_COMMANDS } from "@/player/help/spoken";
import { savedRun } from "./support/savedRun";
import { askByKey } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "131");
const player = (page: Page) => page.getByTestId("player");
const help = (page: Page) => page.getByTestId("help");
const helpButton = (page: Page) => page.getByTestId("help-button");

async function open(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

for (const [vp, viewport] of Object.entries(VIEWPORTS))
  for (const theme of ["light", "dark"] as const)
    test.describe(`${vp}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme });

      test("? opens the help with every key and spoken command; it fits the screen; Escape closes it", async ({
        page,
      }) => {
        await using run = await savedRun(`e2e-help-${vp}-${theme}`);
        await open(page, run.lessonId);
        await expect(help(page)).toBeHidden();
        await page.keyboard.press("?");
        await expect(help(page)).toBeVisible();
        const keys = help(page).getByTestId("help-keys");
        await expect(keys.locator("[data-shortcut]")).toHaveCount(
          SHORTCUTS.length,
        );
        for (const s of SHORTCUTS)
          await expect(keys.locator(`[data-shortcut="${s.id}"]`)).toContainText(
            s.does,
          );
        const spoken = help(page).getByTestId("help-spoken");
        await expect(spoken.locator("[data-command]")).toHaveCount(
          Object.keys(SPOKEN_COMMANDS).length,
        );
        await expect(spoken).toContainText("“Carry on”");
        await expect(spoken).toContainText("“Go to step 3”");
        // Inside the screen, with no sideways scroll.
        const box = (await help(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await expect(
          help(page).getByRole("button", { name: "Close" }),
        ).toBeFocused();
        await mkdir(EVIDENCE, { recursive: true });
        await page.screenshot({
          path: path.join(EVIDENCE, `help-${vp}-${theme}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(help(page)).toBeHidden();
      });

      test("the top bar's ? button opens it, within reach; Close shuts it", async ({
        page,
      }) => {
        await using run = await savedRun(`e2e-help-btn-${vp}-${theme}`);
        await open(page, run.lessonId);
        await expect(helpButton(page)).toBeInViewport({ ratio: 1 });
        if (vp === "mobile")
          expect(
            (await helpButton(page).boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44);
        await helpButton(page).click();
        await expect(help(page)).toBeVisible();
        await help(page).getByRole("button", { name: "Close" }).click();
        await expect(help(page)).toBeHidden();
        await expect(helpButton(page)).toBeFocused();
      });
    });

test("keys pressed in the help don't reach the lesson: → doesn't move on, R doesn't replay", async ({
  page,
}) => {
  await using run = await savedRun("e2e-help-keys");
  await open(page, run.lessonId);
  await page.keyboard.press("?");
  await expect(help(page)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("r");
  await expect(player(page)).toHaveAttribute("data-step", "0");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Escape");
  await expect(help(page)).toBeHidden();
  // Back in the lesson, the keys work again.
  await page.keyboard.press(" ");
  await expect(player(page)).toHaveAttribute("data-state", "paused");
});

test("with Ask open, Escape closes the help, not Ask", async ({ page }) => {
  await using run = await savedRun("e2e-help-ask");
  await open(page, run.lessonId);
  await askByKey(page);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await helpButton(page).click();
  await expect(help(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help(page)).toBeHidden();
  await expect(player(page)).toHaveAttribute("data-state", "asking");
});

test("the dev player has no Ask panel: the help lists the keys only, no spoken commands or A", async ({
  page,
}) => {
  await page.goto("/dev/player");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("?");
  await expect(help(page)).toBeVisible();
  await expect(help(page).getByTestId("help-spoken")).toHaveCount(0);
  await expect(help(page).locator('[data-shortcut="ask"]')).toHaveCount(0);
  await expect(help(page).locator("[data-shortcut]")).toHaveCount(
    SHORTCUTS.length - 1,
  );
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, "help-dev-player.png") });
});

test("the lesson outline's key hints come from the shortcut table", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await using run = await savedRun("e2e-help-outline");
  await open(page, run.lessonId);
  const keys = page.getByTestId("outline-keys");
  for (const line of shortcutHintLines())
    for (const { label, hint } of line) {
      await expect(
        keys.locator("kbd").getByText(label, { exact: true }),
      ).toHaveCount(1);
      await expect(keys).toContainText(hint);
    }
});
