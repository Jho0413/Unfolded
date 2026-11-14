// Where e2e saves lesson runs: its own folder, never the real runs/ (ARCHITECTURE.md
// section 9, RUNS_DIR). playwright.config.ts gives the server this folder, so the tests and
// the server agree. lib/config.ts imports "server-only", so it can't be imported here.
import path from "node:path";

/** RUNS_DIR for the e2e server, relative to the project. */
export const E2E_RUNS_DIR_NAME = "runs-e2e";

export const RUNS_DIR = path.join(process.cwd(), E2E_RUNS_DIR_NAME);
