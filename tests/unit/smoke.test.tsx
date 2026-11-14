import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { resetEnvForTests } from "@/lib/env";

// The page waits for a request (connection()), which a test has no need to.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("smoke", () => {
  it("renders the home page heading", async () => {
    vi.stubEnv("REPLAY_RUN", undefined);
    vi.stubEnv("FAKE_APIS", "1");
    expect(renderToStaticMarkup(await Home())).toContain("<h1>Whiteboard</h1>");
  });
});
