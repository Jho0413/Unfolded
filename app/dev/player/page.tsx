// DEV ONLY (ARCHITECTURE.md section 3): the player with a fake two-step
// lesson, for the player tests (ROADMAP P5) until the lesson page (P6) can
// load a saved run. Query parameters are in ./fakeLesson.ts.
//
// Production builds answer 404 unless FAKE_APIS=1 (app/dev/devOnly.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesEnabled } from "../devOnly";
import { DevPlayer } from "./DevPlayer";
import { parseFakeOptions } from "./fakeLesson";

export const metadata: Metadata = {
  title: "Dev: player",
  robots: { index: false, follow: false },
};

export default async function DevPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!devPagesEnabled()) notFound();
  const options = parseFakeOptions(await searchParams);
  return (
    <main
      data-testid="dev-player"
      style={{
        fontFamily: "system-ui, sans-serif",
        background: "#f8fafc",
        color: "#1f2937",
        minHeight: "100vh",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <p
        role="note"
        style={{
          margin: "0 0 12px",
          padding: "6px 12px",
          background: "#fef3c7",
          border: "1px solid #d97706",
          borderRadius: 6,
          display: "inline-block",
          fontWeight: 600,
        }}
      >
        Dev only: player test page with a fake lesson, not part of the product.
      </p>
      <DevPlayer options={options} />
    </main>
  );
}
