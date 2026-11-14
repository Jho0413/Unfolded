// The whiteboard (ARCHITECTURE.md section 5.3): draws a BoardState as SVG in
// the 1600 x 900 canvas. It is a pure function of the state, with no Motion
// and no animation state: the caller passes sceneAt(..., t) on each frame,
// and effects in progress (fades, highlights) come from `active` progress.
// Moves are already interpolated by sceneAt.
import type { BoardState } from "@/shared/scene";
import { CANVAS } from "@/shared/scene";
import { Copy, Matrix, copyKey } from "./primitives/Matrix";
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
        switch (s.object.kind) {
          case "matrix":
            return <Matrix key={s.object.id} state={s} active={active} />;
          case "text":
            return <Text key={s.object.id} state={s} active={active} />;
          default:
            // latex, arrow and image arrive with P7 and E1.
            return null;
        }
      })}
      {/* Copies are drawn last, so a sliding row passes over the board. */}
      {copies.map((copy) => {
        const source = byId.get(copy.source.id);
        if (source?.object.kind !== "matrix") return null;
        return (
          <Copy
            key={copyKey(copy)}
            copy={copy}
            source={source}
            active={active}
          />
        );
      })}
    </svg>
  );
}
