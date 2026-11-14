// The upload page (ROADMAP L1): a PDF in, the lesson's plan out, then into the lesson.
import { INK, PAGE_BG } from "@/player/primitives/style";
import { UploadForm } from "./UploadForm";

export default function Home() {
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
