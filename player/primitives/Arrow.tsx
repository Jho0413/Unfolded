// An arrow between two anchors, drawn where they are now: it resolves its ends
// on the current BoardState, so it follows an object or a moved copy as it
// slides (ARCHITECTURE.md section 4). An arrow itself never moves.
import type {
  ActiveAction,
  ArrowObject,
  BoardState,
  ObjectState,
} from "@/shared/scene";
import { resolveAnchor } from "@/player/sceneAt";
import { type ArrowGeometry, arrowGeometry, targetBox } from "./arrowGeometry";
import {
  ARROW,
  BOARD_BG,
  HIGHLIGHT,
  INK,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
  textBox,
} from "./style";

export function Arrow({
  arrow,
  state,
  board,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  arrow: ArrowObject;
  state: ObjectState;
  /** The whole board, to resolve the ends against. */
  board: BoardState;
  active: readonly ActiveAction[];
}) {
  const from = resolveAnchor(board, arrow.from);
  const to = resolveAnchor(board, arrow.to);
  const geometry =
    from &&
    to &&
    arrowGeometry(
      from,
      to,
      targetBox(board, arrow.from),
      targetBox(board, arrow.to),
      arrow.label ? textBox(arrow.label, ARROW.labelFont) : undefined,
    );
  const opacity = state.visible ? fadeOpacity(active, { id: arrow.id }) : 0;
  const hl = state.highlight;
  const hlProgress = objectProgress(active, "highlight", arrow.id, hl);
  return (
    <g
      data-object-id={arrow.id}
      data-kind="arrow"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-highlight={highlightAttr(hl)}
      data-highlight-opacity={opacityAttr(hl ? hlProgress : 0)}
      data-from-x={from?.x}
      data-from-y={from?.y}
      data-to-x={to?.x}
      data-to-y={to?.y}
      data-label-text={arrow.label}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {/* Unresolvable ends (validate.ts rejects them upstream): nothing to draw. */}
      {geometry && (
        <>
          <Shape geometry={geometry} color={INK} />
          {hl && (
            <Shape
              geometry={geometry}
              color={HIGHLIGHT[hl].stroke}
              opacity={hlProgress}
            />
          )}
          {arrow.label && (
            <text
              x={geometry.label.x}
              y={geometry.label.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={ARROW.labelFont}
              fill={INK}
              stroke={BOARD_BG}
              strokeWidth={ARROW.labelHalo}
              paintOrder="stroke"
            >
              {arrow.label}
            </text>
          )}
        </>
      )}
    </g>
  );
}

function Shape({
  geometry,
  color,
  opacity,
}: {
  geometry: ArrowGeometry;
  color: string;
  opacity?: number;
}) {
  const { x1, y1, x2, y2, head } = geometry;
  return (
    <g opacity={opacity}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={ARROW.stroke}
        strokeLinecap="round"
      />
      <polygon points={head} fill={color} />
    </g>
  );
}
