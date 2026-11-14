// A text object, centred on (x, y), with an optional whole-object highlight.
import type { ActiveAction, ObjectState, TextObject } from "@/shared/scene";
import {
  HIGHLIGHT,
  INK,
  TEXT_SIZE,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
} from "./style";

/** Rough text width, for the highlight box (no layout pass in a pure render). */
function approxWidth(text: string, fontSize: number): number {
  return Math.max(1, [...text].length) * fontSize * 0.62;
}

export function Text({
  state,
  active,
}: {
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const text = state.object as TextObject;
  const size = text.size ?? "m";
  const fontSize = TEXT_SIZE[size];
  const opacity = state.visible ? fadeOpacity(active, { id: text.id }) : 0;
  const hl = state.highlight;
  const boxW = approxWidth(text.text, fontSize) + fontSize * 0.62;
  const boxH = fontSize * 1.4;
  return (
    <g
      data-object-id={text.id}
      data-kind="text"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-highlight={highlightAttr(hl)}
      data-size={size}
      data-text={text.text}
      data-x={text.x}
      data-y={text.y}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {hl && (
        <rect
          x={text.x - boxW / 2}
          y={text.y - boxH / 2}
          width={boxW}
          height={boxH}
          rx={8}
          fill={HIGHLIGHT[hl].fill}
          stroke={HIGHLIGHT[hl].stroke}
          strokeWidth={2}
          opacity={objectProgress(active, "highlight", text.id)}
        />
      )}
      <text
        x={text.x}
        y={text.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={INK}
        opacity={objectProgress(active, "write", text.id)}
      >
        {text.text}
      </text>
    </g>
  );
}
