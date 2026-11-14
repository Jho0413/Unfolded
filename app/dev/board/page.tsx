// DEV ONLY (ARCHITECTURE.md section 3): renders a BoardState through the
// whiteboard, for renderer tests and screenshots. Not part of the product.
//
//   /dev/board                              the fixed BoardState
//   /dev/board?scene=m1&t=3400              demo-m1 at 3400 ms, via sceneAt
//   /dev/board?scene=m1-late-highlight&t=…  demo-m1 with a highlight after the slide
//
// Production servers answer 404 unless in fake mode (app/dev/devOnly.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FRAME_BORDER } from "@/player/primitives/style";
import { Whiteboard } from "@/player/Whiteboard";
import { CANVAS } from "@/shared/scene";
import { DevShell } from "../DevShell";
import { devPagesEnabled } from "../devOnly";
import { first, type SearchParams } from "../query";
import { M1_CUE_TIMES, SCENES, isScene, sceneState } from "./scenes";

export const metadata: Metadata = {
  title: "Dev: board",
  robots: { index: false, follow: false },
};

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await devPagesEnabled())) notFound();

  const params = await searchParams;
  const sceneParam = first(params.scene) ?? "fixed";
  const scene = isScene(sceneParam) ? sceneParam : "fixed";
  const parsedT = Number(first(params.t) ?? 0);
  const tMs = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : 0;
  const state = sceneState(scene, tMs);
  const timed = scene !== "fixed";

  return (
    <DevShell
      note="Dev only: renderer test page, not part of the product."
      data-testid="dev-board"
      data-scene={scene}
      data-t={timed ? tMs : undefined}
    >
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
          maxWidth: CANVAS.w,
          border: `1px solid ${FRAME_BORDER}`,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <Whiteboard state={state} />
      </div>
    </DevShell>
  );
}
