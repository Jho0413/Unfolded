// The dev-only /dev/board page (ARCHITECTURE.md section 3) is not reachable
// in a production server unless FAKE_APIS=1 (how e2e and CI run it).
import { afterEach, describe, expect, it, vi } from "vitest";
import DevBoardPage from "@/app/dev/board/page";

const props = { searchParams: Promise.resolve({}) };

afterEach(() => vi.unstubAllEnvs());

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
});
