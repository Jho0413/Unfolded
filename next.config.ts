import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Otherwise `next dev` rewrites the team's AGENTS.md in every checkout, leaving an
  // uncommitted change to a shared file. Agents can read node_modules/next/dist/docs directly.
  agentRules: false,
  // Inlined at build time whether or not it is set, so lib/env.ts can tell at start whether
  // this build has the browser's fake agent baked in (ARCHITECTURE.md section 9).
  env: { BUILT_WITH_BROWSER_FAKES: process.env.NEXT_PUBLIC_FAKE_APIS ?? "" },
};

export default nextConfig;
