// The lesson page (ROADMAP P6, L2, L3, ARCHITECTURE.md sections 3 and 5): plays the lesson in
// runs/<lessonId>/ in the player. The plan is read here, on the server; each step comes through
// POST /api/lessons/<lessonId>/steps/<n> (saved, or generated now), and its audio through
// GET /api/runs.
//
// A bad lessonId or a lesson with no saved plan is a 404 with "No such lesson or step."
// (./not-found.tsx). A step the route can't give fails in the player with the route's message
// ("Couldn't make this step.", or in replay "This step isn't in the saved run."), and Retry
// or Back recover.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { INK, PAGE_BG } from "@/player/primitives/style";
import { LessonView } from "./LessonView";
import { loadLesson } from "./loadLesson";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
  searchParams,
}: PageProps<"/lesson/[lessonId]">) {
  // A run folder changes after the build, so it's read on every request.
  await connection();
  const { lessonId } = await params;
  const lesson = await loadLesson(lessonId);
  if (lesson.kind === "missing") notFound();
  const { debug } = await searchParams;
  return (
    <main style={PAGE}>
      <LessonView
        lessonId={lesson.lessonId}
        plan={lesson.plan}
        replay={getEnv().mode === "replay"}
        debug={debug === "1"}
      />
    </main>
  );
}

const PAGE = {
  fontFamily: "system-ui, sans-serif",
  background: PAGE_BG,
  color: INK,
  minHeight: "100vh",
  padding: 24,
  boxSizing: "border-box",
} as const;
