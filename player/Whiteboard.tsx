// The whiteboard (ARCHITECTURE.md section 5.3): draws a BoardState as SVG in
// the 1600 x 900 canvas. It is a pure function of the state, with no Motion
// and no animation state: the caller passes sceneAt(..., t) on each frame,
// and effects in progress (fades, highlights) come from `active` progress.
// Moves are already interpolated by sceneAt, and arrows resolve their ends
// on the state, so they follow what they point at.
import type { BoardState } from "@/shared/scene";
import { CANVAS } from "@/shared/scene";
import { partKey } from "./sceneAt";
import { Arrow } from "./primitives/Arrow";
import { Latex } from "./primitives/Latex";
import { Copy, Matrix } from "./primitives/Matrix";
import { Text } from "./primitives/Text";
import { BOARD_BG, FONT } from "./primitives/style";

export function Whiteboard({
  state,
  className,
}: {
  state: BoardState;
  className?: string;
}) {
  const { objects, copies, active } = state;
  const byId = new Map(objects.map((s) => [s.object.id, s]));
  return (
    <svg
      data-testid="whiteboard"
      className={className}
      viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
      role="img"
      aria-label="Whiteboard"
      style={{ display: "block", width: "100%", height: "auto" }}
      fontFamily={FONT}
    >
      <rect width={CANVAS.w} height={CANVAS.h} fill={BOARD_BG} />
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
      {/* Copies are drawn last, so a sliding row passes over the board. */}
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
    </svg>
  );
}
