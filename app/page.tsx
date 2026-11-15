// The upload page (ROADMAP L1, ARCHITECTURE.md section 5.1): a PDF in, the lesson's plan out,
// then into the lesson, with a miniature lesson beside it and the sample lessons this server
// has. In replay mode (REPLAY_RUN, section 5.5) it goes straight to the saved lesson.
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { sampleLessons } from "./samples";
import { UploadView } from "./UploadView";

export default async function Home() {
  // Decided per request: a prerendered page would fix the build's env, not the server's.
  await connection();
  const env = getEnv();
  if (env.mode === "replay") redirect(`/lesson/${env.replayRun}`);
  return <UploadView samples={await sampleLessons()} />;
}
