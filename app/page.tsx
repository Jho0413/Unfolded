// The upload page (ROADMAP L1): a PDF in, the lesson's plan out, then into the lesson. In
// replay mode (REPLAY_RUN, ARCHITECTURE.md section 5.5) it goes straight to the saved lesson.
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { INK, PAGE_BG } from "@/player/primitives/style";
import { UploadForm } from "./UploadForm";

export default async function Home() {
  // Decided per request: a prerendered page would fix the build's env, not the server's.
  await connection();
  const env = getEnv();
  if (env.mode === "replay") redirect(`/lesson/${env.replayRun}`);
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        background: PAGE_BG,
        color: INK,
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1>Whiteboard</h1>
        <p>An AI tutor that teaches by drawing. Upload a paper to start.</p>
        <UploadForm />
      </div>
    </main>
  );
}
