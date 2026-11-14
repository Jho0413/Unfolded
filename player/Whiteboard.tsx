// The whiteboard (ARCHITECTURE.md section 5.3): draws a BoardState as SVG in
// the 1600 x 900 canvas. It is a pure function of the state, with no Motion
// and no animation state: the caller passes sceneAt(..., t) on each frame,
// and effects in progress (fades, highlights) come from `active` progress.
// Moves are already interpolated by sceneAt, and arrows resolve their ends
// on the state, so they follow what they point at.
//
// A Q&A sketch's objects (`sketchIds`) go in their own layer, drawn in the
// answer blue; while there are any, the lesson's layer dims (player/theme.css).
import type { BoardState } from "@/shared/scene";
import { CANVAS } from "@/shared/scene";
import { partKey } from "./sceneAt";
import { Arrow } from "./primitives/Arrow";
import { Latex } from "./primitives/Latex";
import { Copy, Matrix } from "./primitives/Matrix";
import { Text } from "./primitives/Text";
import { BOARD_BG, FONT } from "./primitives/style";

type ObjectState = BoardState["objects"][number];

export function Whiteboard({
  state,
  className,
  sketchIds,
}: {
  state: BoardState;
  className?: string;
  /** Objects a Q&A sketch drew (ARCHITECTURE.md section 8). */
  sketchIds?: ReadonlySet<string>;
}) {
  const { objects, copies } = state;
  const byId = new Map(objects.map((s) => [s.object.id, s]));
  const inSketch = (id: string) => sketchIds?.has(id) ?? false;
  const sketching = objects.some((s) => inSketch(s.object.id));
  return (
    <svg
      data-testid="whiteboard"
      data-sketching={sketching}
      className={className}
      viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
      role="img"
      aria-label="Whiteboard"
      style={{ display: "block", width: "100%", height: "auto" }}
      fontFamily={FONT}
    >
      <rect width={CANVAS.w} height={CANVAS.h} fill={BOARD_BG} />
      <g data-layer="main">
        <Layer
          state={state}
          byId={byId}
          objects={objects.filter((s) => !inSketch(s.object.id))}
          copies={copies.filter((c) => !inSketch(c.source.id))}
        />
      </g>
      {sketching && (
        <g data-layer="sketch">
          <Layer
            state={state}
            byId={byId}
            objects={objects.filter((s) => inSketch(s.object.id))}
            copies={copies.filter((c) => inSketch(c.source.id))}
          />
        </g>
      )}
    </svg>
  );
}

/** One layer: its objects, then their moved copies, then their arrows. */
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
