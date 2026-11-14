// A bad lessonId, or a lesson with no saved plan (ARCHITECTURE.md section 7): plain words and
// the way back to the upload page.
import Link from "next/link";
import { INK, PAGE_BG } from "@/player/primitives/style";
import { NO_SUCH_LESSON } from "@/shared/lesson";

export default function LessonNotFound() {
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
      <p role="alert" data-testid="lesson-error" style={{ fontSize: 20 }}>
        {NO_SUCH_LESSON}
      </p>
      <Link href="/">Back to upload</Link>
    </main>
  );
}
