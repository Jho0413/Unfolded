import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Otherwise `next dev` rewrites the team's AGENTS.md in every checkout, leaving an
  // uncommitted change to a shared file. Agents can read node_modules/next/dist/docs directly.
  agentRules: false,
};

export default nextConfig;
