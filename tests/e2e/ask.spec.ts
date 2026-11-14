// The Ask panel on /dev/ask with the fake conversation (ROADMAP Q3,
// ARCHITECTURE.md sections 6.1, 7 and 8). The build has NEXT_PUBLIC_FAKE_APIS=1,
// so the page's conversation is qa/fakeConversation.ts, exposed as
// window.__qaFake for these tests.
import { expect, type Page, test } from "@playwright/test";

const ASK = {
  unavailable: "Questions are unavailable right now.",
  ended: "Q&A ended unexpectedly.",
  micOff: "Mic is off. Type your question; the answer will appear as text.",
  needsConnection: "Q&A needs a connection.",
  sketchFailed: "Couldn't draw that.",
};

async function open(page: Page, query = "") {
  await page.goto(`/dev/ask${query}`);
  await expect(page.getByTestId("dev-ask")).toHaveAttribute(
    "data-state",
    "loading",
  );
}

async function toPlaying(page: Page) {
  await page.getByRole("button", { name: "stepReady" }).click();
  await expect(page.getByTestId("dev-ask")).toHaveAttribute(
    "data-state",
    "playing",
  );
}

async function askAndConnect(page: Page) {
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("dev-ask")).toHaveAttribute(
    "data-state",
    "asking",
  );
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );
}

async function typeQuestion(page: Page, text: string) {
  await page.getByLabel("Type your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByTestId("ask-transcript").locator('[data-role="user"]').last(),
  ).toContainText(text);
}

const notice = (page: Page) => page.getByTestId("ask-notice");
const state = (page: Page) => page.getByTestId("dev-ask");

test.describe("Ask with the fake conversation", () => {
  test("typed question -> asking -> close -> back to the previous state (playing becomes paused)", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await typeQuestion(page, "What is this?");
    await expect(
      page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
    ).toContainText("row times a column");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    await expect(page.getByTestId("ask-panel")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await expect(notice(page)).toHaveCount(0);
  });

  test("close from stepEnded goes back to stepEnded", async ({ page }) => {
    await open(page);
    await toPlaying(page);
    await page.getByRole("button", { name: "audioEnded" }).click();
    await askAndConnect(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "stepEnded");
  });

  test("the A key opens Ask, A while typing doesn't, and Escape closes it", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("a");
    await expect(state(page)).toHaveAttribute("data-state", "asking");
    await expect(page.getByTestId("ask-panel")).toHaveAttribute(
      "data-phase",
      "connected",
    );
    await page.getByLabel("Type your question").pressSequentially("a");
    await expect(page.getByLabel("Type your question")).toHaveValue("a");
    await page.getByLabel("Type your question").blur();
    await page.keyboard.press("Escape");
    await expect(state(page)).toHaveAttribute("data-state", "paused");
  });

  test("sends the context on connect, mutes the mic while typing and sends user activity", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    const ctx =
      (await page.evaluate(() => window.__qaFake?.contextUpdates)) ?? [];
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toContain("1. Matrices (current step)");
    expect(ctx[0]).toContain("Objects on the board (ids for highlight): q, a");
    expect(ctx[0]).toContain("Narration of step 1 so far");
    expect(await page.evaluate(() => window.__qaFake?.micMuted)).toBe(false);
    await page.getByLabel("Type your question").pressSequentially("Why");
    expect(await page.evaluate(() => window.__qaFake?.micMuted)).toBe(true);
    expect(await page.evaluate(() => window.__qaFake?.userActivity)).toBe(3);
    await page.getByLabel("Type your question").blur();
    expect(await page.evaluate(() => window.__qaFake?.micMuted)).toBe(false);
  });

  test("a step change while asking sends a new context with the earlier questions", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await typeQuestion(page, "go to step 3");
    await expect(page.getByTestId("tool-log")).toContainText(
      'go_to_step {"step":3} -> ok',
    );
    await expect
      .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates.length))
      .toBe(2);
    const last = await page.evaluate(() =>
      window.__qaFake?.contextUpdates.at(-1),
    );
    expect(last).toContain("1. Matrices (current step)");
    expect(last).toContain("3. Attention (next, after this question)");
    expect(last).toContain("Objects on the board (ids for highlight): q, a");
    expect(last).toContain("- go to step 3");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "loading");
    await expect(state(page)).toHaveAttribute("data-step", "2");
    await page.getByRole("button", { name: "stepReady" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    await expect(state(page)).toHaveAttribute("data-step", "2");
  });
});

test.describe("client tools on /dev/ask (ROADMAP Q4)", () => {
  test("highlight: ok, drawn on the board, thrown away when Ask closes", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await typeQuestion(page, "show me the first row");
    await expect(page.getByTestId("tool-log")).toContainText(
      'highlight {"target_id":"q","row":0} -> ok',
    );
    await expect(
      page
        .getByTestId("highlights")
        .locator(`[data-target='${JSON.stringify({ id: "q", row: 0 })}']`),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("highlights").locator("li")).toHaveCount(0);
  });

  test('go_to_step outside the plan: "no step n", still asking', async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await typeQuestion(page, "go to step 9");
    await expect(page.getByTestId("tool-log")).toContainText(
      'go_to_step {"step":9} -> no step 9',
    );
    await expect(state(page)).toHaveAttribute("data-state", "asking");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    await expect(state(page)).toHaveAttribute("data-step", "0");
  });
});

/** Every data-* attribute on the whiteboard, in document order. */
function boardAttributes(page: Page): Promise<string> {
  return page
    .getByTestId("whiteboard")
    .evaluate((svg) =>
      [svg, ...svg.querySelectorAll("*")]
        .flatMap((el) =>
          [...el.attributes]
            .filter((a) => a.name.startsWith("data-"))
            .map((a) => `${a.name}=${a.value}`),
        )
        .join("\n"),
    );
}

const SKETCH = {
  objects: [{ kind: "text", id: "note", x: 600, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "q", row: 0 }, atMs: 0 }],
};

test.describe("draw_scene on /dev/ask (ROADMAP Q5)", () => {
  test("a valid sketch is drawn when it arrives, while the conversation continues", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/sketch", async (route) => {
      await gate;
      await route.fulfill({ json: { sketch: SKETCH } });
    });
    await open(page);
    await toPlaying(page);
    const before = await boardAttributes(page);
    await askAndConnect(page);
    const request = page.waitForRequest("**/api/sketch");
    await typeQuestion(page, "can you draw it?");
    const body = (await request).postDataJSON() as {
      description: string;
      fresh: boolean;
      board: { objects: { object: { id: string } }[] };
    };
    expect(body.description).toBe("Circle the first row of q");
    expect(body.fresh).toBe(false);
    expect(body.board.objects.map((o) => o.object.id)).toEqual(["q", "a"]);
    // The agent answers at once: draw_scene doesn't wait for the sketch.
    await expect(
      page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
    ).toContainText("Let me sketch that");
    await expect(page.getByTestId("tool-log")).toContainText(
      'draw_scene {"description":"Circle the first row of q","fresh":false} -> (no result)',
    );
    const note = page
      .getByTestId("whiteboard")
      .locator('[data-object-id="note"]');
    await expect(note).toHaveCount(0);
    release();
    await expect(note).toHaveCount(1);
    // The sketch's highlight on q row 0 shows too.
    await expect
      .poll(async () => (await boardAttributes(page)).includes("accent"))
      .toBe(true);
    await expect(page.getByTestId("ask-tool-notice")).toHaveCount(0);
    // Closing Ask throws the drawing away: the board's data-* attributes
    // match those from before Ask.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(note).toHaveCount(0);
    await expect.poll(() => boardAttributes(page)).toBe(before);
  });

  for (const [name, reply] of [
    ["an error response", { status: 502, json: { error: ASK.sketchFailed } }],
    [
      "a sketch invalid on the board",
      {
        status: 200,
        json: {
          sketch: {
            objects: [],
            actions: [{ do: "highlight", target: { id: "zz" }, atMs: 0 }],
          },
        },
      },
    ],
  ] as const) {
    test(`${name}: "${ASK.sketchFailed}", and the agent is told`, async ({
      page,
    }) => {
      await page.route("**/api/sketch", (route) => route.fulfill(reply));
      await open(page);
      await toPlaying(page);
      await askAndConnect(page);
      await typeQuestion(page, "can you draw it?");
      await expect(page.getByTestId("ask-tool-notice")).toHaveText(
        ASK.sketchFailed,
      );
      await expect
        .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates.at(-1)))
        .toContain("couldn't be drawn");
      await expect(
        page.getByTestId("whiteboard").locator('[data-object-id="zz"]'),
      ).toHaveCount(0);
    });
  }
});

test.describe("Ask messages (ARCHITECTURE.md section 7)", () => {
  test(`session drops mid-question: "${ASK.ended}"`, async ({ page }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await page.evaluate(() => window.__qaFake?.drop());
    await expect(notice(page)).toHaveText(ASK.ended);
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    // Ask again clears it.
    await askAndConnect(page);
    await expect(notice(page)).toHaveCount(0);
  });

  test("the agent ends the session normally: back to the previous state, no message", async ({
    page,
  }) => {
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await page.evaluate(() => window.__qaFake?.hangUp());
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    await expect(page.getByTestId("ask-panel")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await expect(notice(page)).toHaveCount(0);
  });

  test(`token route fails: "${ASK.unavailable}"`, async ({ page }) => {
    await page.route("**/api/agent/token", (route) =>
      route.fulfill({ status: 503, json: { error: ASK.unavailable } }),
    );
    await open(page);
    await toPlaying(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(notice(page)).toHaveText(ASK.unavailable);
    await expect(page.getByTestId("ask-panel")).toHaveAttribute(
      "data-phase",
      "failed",
    );
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    await expect(notice(page)).toHaveCount(0);
  });

  test(`the agent can't connect: "${ASK.unavailable}"`, async ({ page }) => {
    await page.route("**/api/agent/token", (route) =>
      route.fulfill({ json: { conversationToken: "fake-connect-fail" } }),
    );
    await open(page);
    await toPlaying(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(notice(page)).toHaveText(ASK.unavailable);
    await expect(state(page)).toHaveAttribute("data-state", "asking");
  });

  test(`microphone permission denied: "${ASK.micOff}"`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __qaFakeMicDenied?: boolean }).__qaFakeMicDenied = true;
    });
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await expect(notice(page)).toHaveText(ASK.micOff);
    await expect(page.getByTestId("ask-panel")).toHaveAttribute(
      "data-text-only",
      "true",
    );
    expect(await page.evaluate(() => window.__qaFake?.textOnly)).toBe(true);
    await typeQuestion(page, "What is this?");
    await expect(
      page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
    ).toContainText("row times a column");
  });

  test("a failed sketch in a text-only session keeps the mic message", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as { __qaFakeMicDenied?: boolean }).__qaFakeMicDenied = true;
    });
    await page.route("**/api/sketch", (route) =>
      route.fulfill({ status: 502, json: { error: ASK.sketchFailed } }),
    );
    await open(page);
    await toPlaying(page);
    await askAndConnect(page);
    await typeQuestion(page, "can you draw it?");
    await expect(page.getByTestId("ask-tool-notice")).toHaveText(
      ASK.sketchFailed,
    );
    await expect(notice(page)).toHaveText(ASK.micOff);
  });

  test(`replay mode: "${ASK.needsConnection}"`, async ({ page }) => {
    let tokenRequests = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/agent/token")) tokenRequests++;
    });
    await open(page, "?replay=1");
    await toPlaying(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(notice(page)).toHaveText(ASK.needsConnection);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused");
    expect(tokenRequests).toBe(0);
  });
});
