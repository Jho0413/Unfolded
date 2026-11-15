// An arrow between two anchors, drawn where they are now: it resolves its ends
// on the current BoardState, so it follows an object or a moved copy as it
// slides (ARCHITECTURE.md section 4). An arrow itself never moves.
// While shown it draws itself on from its tail, its head lands as the line
// arrives, and its label fades in after (./motion.ts).
import type {
  ActiveAction,
  ArrowObject,
  BoardState,
  ObjectState,
} from "@/shared/scene";
import { resolveAnchor } from "@/player/sceneAt";
import { type ArrowGeometry, arrowGeometry, targetBox } from "./arrowGeometry";
import { textBox } from "@/shared/boxes";
import {
  ARROW,
  BOARD_BG,
  HIGHLIGHT,
  INK,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
} from "./style";
import { easeOutCubic, span } from "@/player/easing";
import {
  appearance,
  drawAttr,
  drawOnProps,
  highlightLook,
  useReducedMotion,
} from "./motion";

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
  const reduced = useReducedMotion();
  const look = appearance(
    active,
    { id: arrow.id },
    state.visible,
    "stroke",
    reduced,
  );
  const hlLook = highlightLook(hlProgress, reduced);
  const labelIn = reduced ? 1 : easeOutCubic(span(look.enter, 0.45, 0.55));
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
      data-draw={drawAttr(look.draw)}
      opacity={look.opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {/* Unresolvable ends (validate.ts rejects them upstream): nothing to draw. */}
      {geometry && (
        <>
          <Shape geometry={geometry} color={INK} draw={look.draw} />
          {hl && (
            <g
              className="wb-glow"
              style={{ ["--hl" as string]: HIGHLIGHT[hl].stroke }}
            >
              <Shape
                geometry={geometry}
                color={HIGHLIGHT[hl].stroke}
                opacity={hlLook.opacity}
                draw={look.draw}
                swell={hlLook.pulse}
              />
            </g>
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
              opacity={labelIn < 1 ? labelIn : undefined}
            >
              {arrow.label}
            </text>
          )}
        </>
      )}
    </g>
  );
}

/**
 * The line drawn on to `draw` (0..1) from its tail, and the head, which lands over the last
 * fifth of the draw. `swell` (a highlight's pulse, 0..1) thickens the line for a moment.
 */
function Shape({
  geometry,
  color,
  opacity,
  draw,
  swell = 0,
}: {
  geometry: ArrowGeometry;
  color: string;
  opacity?: number;
  draw: number;
  swell?: number;
}) {
  const { x1, y1, x2, y2, head } = geometry;
  const headIn = span(draw, 0.8, 0.2);
  return (
    <g opacity={opacity}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        {...drawOnProps(draw)}
        stroke={color}
        strokeWidth={ARROW.stroke + 2 * swell}
        strokeLinecap="round"
      />
      <polygon
        points={head}
        fill={color}
        opacity={headIn < 1 ? headIn : undefined}
      />
    </g>
  );
}
