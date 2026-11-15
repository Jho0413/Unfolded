// The lesson page (ROADMAP P6, L2, L3, ARCHITECTURE.md sections 3 and 5): plays the lesson in
// runs/<lessonId>/ in the player. The plan is read here, on the server; each step comes through
// POST /api/lessons/<lessonId>/steps/<n> (saved, or generated now), and its audio through
// GET /api/runs.
//
// A bad lessonId or a lesson with no saved plan is a 404 with "No such lesson or step."
// (./not-found.tsx). A step the route can't give fails in the player with the route's message
// ("Couldn't make this step.", or in replay "This step isn't in the saved run."), and Retry,
// Next or Back recover.
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { LessonView } from "./LessonView";
import { loadLesson } from "./loadLesson";

export const metadata: Metadata = { title: "Lesson" };

/** Phones: the page reaches under the notch, and lesson.module.css pads by the safe areas. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
    <LessonView
      lessonId={lesson.lessonId}
      plan={lesson.plan}
      replay={getEnv().mode === "replay"}
      debug={debug === "1"}
    />
  );
}
