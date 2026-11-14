// Runs once when the server starts (ARCHITECTURE.md section 9): validates the env, so a
// missing key stops the server with an error naming it. Never at build: `next build` needs
// no keys.
import { PHASE_PRODUCTION_BUILD } from "next/constants";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  // Imported here, not at the top: lib/env.ts uses Node-only APIs (fs, process.exit).
  const { loadEnvOrExit } = await import("@/lib/env");
  const env = loadEnvOrExit();
  console.log(`[env] mode: ${env.mode}`);
}
