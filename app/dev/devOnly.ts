// The gate on the dev-only pages and routes under app/dev (ARCHITECTURE.md
// sections 3 and 9). Production servers answer 404 unless in fake mode
// (FAKE_APIS=1 without REPLAY_RUN, lib/env.ts), which is how e2e and CI run
// the production build, so they are never reachable in a real `npm start`.
import "server-only";
import { connection } from "next/server";
import { fakesEnabled } from "@/lib/fakes";

/**
 * Decided per request, not at build time: without waiting for a request,
 * `next build` would prerender a page and fix the gate with the build's env
 * (a plain build would 404 even under FAKE_APIS=1).
 */
export async function devPagesEnabled(): Promise<boolean> {
  await connection();
  return process.env.NODE_ENV !== "production" || fakesEnabled();
}
