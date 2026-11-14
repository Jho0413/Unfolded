// The dev-only /dev/board page (ARCHITECTURE.md section 3) is not reachable
// in a production server unless FAKE_APIS=1 (how e2e and CI run it).
import { afterEach, describe, expect, it, vi } from "vitest";
import DevBoardPage from "@/app/dev/board/page";

// connection() resolves once a request arrives. During `next build`'s
// prerender it never does, so prerendering stops there.
const { connection } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
}));
vi.mock("next/server", () => ({ connection }));

const props = { searchParams: Promise.resolve({}) };

afterEach(() => {
  vi.unstubAllEnvs();
  connection.mockReset();
  connection.mockImplementation(() => Promise.resolve());
});

describe("/dev/board gate", () => {
  it("404s in production without FAKE_APIS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAKE_APIS", "");
    await expect(DevBoardPage(props)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
  it("renders in production with FAKE_APIS=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAKE_APIS", "1");
    await expect(DevBoardPage(props)).resolves.toBeTruthy();
  });
  it("renders outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(DevBoardPage(props)).resolves.toBeTruthy();
  });
  it("is decided per request, not at build time: a prerender never reaches the gate", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAKE_APIS", "");
    connection.mockImplementation(() => new Promise(() => {}));
    let settled = false;
    void DevBoardPage(props).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connection).toHaveBeenCalled();
    expect(settled).toBe(false);
  });
});
