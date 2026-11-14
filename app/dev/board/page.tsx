// DEV ONLY (ARCHITECTURE.md section 3): renders a BoardState through the
// whiteboard, for renderer tests and screenshots. Not part of the product.
//
//   /dev/board                              the fixed BoardState
//   /dev/board?scene=m1&t=3400              demo-m1 at 3400 ms, via sceneAt
//   /dev/board?scene=m1-late-highlight&t=…  demo-m1 with a highlight after the slide
//
// Production servers answer 404 unless in fake mode (FAKE_APIS=1 without
// REPLAY_RUN, lib/env.ts), which is how e2e and CI run the production build,
// so it is never reachable in a real `npm start`. The gate reads the env per
// request, not at build time.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { fakesEnabled } from "@/lib/fakes";
import { Whiteboard } from "@/player/Whiteboard";
import { HIGHLIGHT, INK } from "@/player/primitives/style";
import { M1_CUE_TIMES, SCENES, isScene, sceneState } from "./scenes";

export const metadata: Metadata = {
  title: "Dev: board",
  robots: { index: false, follow: false },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Without this, `next build` prerenders the page and fixes the gate with
  // the build's env: a plain build would 404 even under FAKE_APIS=1.
  await connection();
  if (process.env.NODE_ENV === "production" && !fakesEnabled()) notFound();

  const params = await searchParams;
  const sceneParam = first(params.scene) ?? "fixed";
  const scene = isScene(sceneParam) ? sceneParam : "fixed";
  const parsedT = Number(first(params.t) ?? 0);
  const tMs = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : 0;
  const state = sceneState(scene, tMs);
  const timed = scene !== "fixed";

  return (
    <main
      data-testid="dev-board"
      data-scene={scene}
      data-t={timed ? tMs : undefined}
      style={{
        fontFamily: "system-ui, sans-serif",
        background: "#f8fafc",
        color: INK,
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
          background: HIGHLIGHT.warn.fill,
          border: `1px solid ${HIGHLIGHT.warn.stroke}`,
          borderRadius: 6,
          display: "inline-block",
          fontWeight: 600,
        }}
      >
        Dev only: renderer test page, not part of the product.
      </p>
      <nav
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}
      >
        {SCENES.map((s) => (
          <Link
            key={s}
            href={
              s === "fixed" ? "/dev/board" : `/dev/board?scene=${s}&t=${tMs}`
            }
            style={{ fontWeight: s === scene ? 700 : 400 }}
          >
            {s}
          </Link>
        ))}
      </nav>
      {timed && (
        <nav
          aria-label="Cue times"
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <span>t = {tMs} ms. Cues:</span>
          {Object.entries(M1_CUE_TIMES).map(([cue, ms]) => (
            <Link key={cue} href={`/dev/board?scene=${scene}&t=${ms}`}>
              {cue} ({ms})
            </Link>
          ))}
        </nav>
      )}
      <div
        style={{
          maxWidth: 1600,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <Whiteboard state={state} />
      </div>
    </main>
  );
}
