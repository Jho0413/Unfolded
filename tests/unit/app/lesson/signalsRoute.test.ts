// The lesson page's signal post (issue #102, app/lesson/[lessonId]/signalsRoute.ts): never
// rejects, a 404 (route missing) is only logged once.
import { describe, expect, it, vi } from "vitest";
import { signalsRoutePoster } from "@/app/lesson/[lessonId]/signalsRoute";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function logs() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("signalsRoutePoster", () => {
  it("posts the signal as JSON and resolves true on { version }", async () => {
    const fetchFn = vi.fn(async () => json(200, { version: 3 }));
    const log = logs();
    const post = signalsRoutePoster("demo-m1", fetchFn, log);
    expect(await post({ question: "why?", step: 1, t: 20 })).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("/api/lessons/demo-m1/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "why?", step: 1, t: 20 }),
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("a 404 (no route yet) resolves false and is logged once, as info", async () => {
    const log = logs();
    const post = signalsRoutePoster(
      "demo-m1",
      async () => json(404, { error: "x" }),
      log,
    );
    expect(await post({ started: 0, version: 1 })).toBe(false);
    expect(await post({ question: "q" })).toBe(false);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("another error status, a body that isn't { version }, or a network failure: false, logged", async () => {
    for (const fetchFn of [
      async () => json(400, { error: "No such lesson or step." }),
      async () => json(200, { nope: true }),
      async () => {
        throw new TypeError("offline");
      },
    ]) {
      const log = logs();
      const post = signalsRoutePoster("demo-m1", fetchFn, log);
      expect(await post({ simplify: "s" })).toBe(false);
      expect(log.error).toHaveBeenCalledTimes(1);
    }
  });
});
