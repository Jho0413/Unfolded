// The whiteboard (ARCHITECTURE.md section 5.3): draws a BoardState as SVG in
// the 1600 x 900 canvas. It is a pure function of the state, with no Motion
// and no animation state: the caller passes sceneAt(..., t) on each frame,
// and effects in progress (fades, highlights) come from `active` progress.
// Moves are already interpolated by sceneAt, and arrows resolve their ends
// on the state, so they follow what they point at.
//
// A Q&A sketch is drawn the same way, in the lesson's own look, on a board of
// its own (the Answer view, app/lesson/[lessonId]/AnswerView.tsx).
import type { BoardState } from "@/shared/scene";
import { CANVAS } from "@/shared/scene";
import { partKey } from "./sceneAt";
import { Arrow } from "./primitives/Arrow";
import { Heatmap } from "./primitives/Heatmap";
import { Latex } from "./primitives/Latex";
import { Copy, Matrix } from "./primitives/Matrix";
import { Plot } from "./primitives/Plot";
import { Text } from "./primitives/Text";
import { BOARD_BG, FONT } from "./primitives/style";
import { FULL_VIEW, type ViewBox } from "./viewport";

type ObjectState = BoardState["objects"][number];

export function Whiteboard({
  state,
  className,
  view = FULL_VIEW,
}: {
  state: BoardState;
  className?: string;
  /** The part of the canvas to show (./viewport.ts), the whole canvas by default. */
  view?: ViewBox;
}) {
  const { objects, copies } = state;
  const byId = new Map(objects.map((s) => [s.object.id, s]));
  return (
    <svg
      data-testid="whiteboard"
      className={className}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      data-view={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="img"
      aria-label="Whiteboard"
      style={{ display: "block", width: "100%", height: "auto" }}
      fontFamily={FONT}
    >
      <rect width={CANVAS.w} height={CANVAS.h} fill={BOARD_BG} />
      <Layer state={state} byId={byId} objects={objects} copies={copies} />
    </svg>
  );
}

/** The objects, then their moved copies, then their arrows. */
function Layer({
  state,
  byId,
  objects,
  copies,
}: {
  state: BoardState;
  byId: ReadonlyMap<string, ObjectState>;
  objects: readonly ObjectState[];
  copies: BoardState["copies"];
}) {
  const { active } = state;
  return (
    <>
      {objects.map((s) => {
        const object = s.object;
        switch (object.kind) {
          case "matrix":
            return (
              <Matrix
                key={object.id}
                matrix={object}
                state={s}
                active={active}
              />
            );
          case "text":
            return (
              <Text key={object.id} text={object} state={s} active={active} />
            );
          case "latex":
            return (
              <Latex key={object.id} latex={object} state={s} active={active} />
            );
          case "arrow":
            return null; // drawn last, below
          case "image":
            return null; // arrives with E1
          case "heatmap":
            return (
              <Heatmap
                key={object.id}
                heatmap={object}
                state={s}
                active={active}
              />
            );
          case "plot":
            return (
              <Plot key={object.id} plot={object} state={s} active={active} />
            );
        }
      })}
      {/* Copies are drawn after the objects, so a sliding row passes over the board. */}
      {copies.map((copy) => {
        const source = byId.get(copy.source.id);
        if (source?.object.kind !== "matrix") return null;
        return (
          <Copy
            key={partKey(copy.source)}
            copy={copy}
            matrix={source.object}
            source={source}
            active={active}
          />
        );
      })}
      {/* Arrows are drawn over everything, so one into a sliding copy stays visible. */}
      {objects.map((s) =>
        s.object.kind === "arrow" ? (
          <Arrow
            key={s.object.id}
            arrow={s.object}
            state={s}
            board={state}
            active={active}
          />
        ) : null,
      )}
    </>
  );
}
