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
  text,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  text: TextObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const size = text.size ?? "m";
  const fontSize = TEXT_SIZE[size];
  const opacity = state.visible ? fadeOpacity(active, { id: text.id }) : 0;
  const hl = state.highlight;
  const boxW = approxWidth(text.text, fontSize) + fontSize;
  const hlProgress = objectProgress(active, "highlight", text.id, hl);
  const writeProgress = objectProgress(active, "write", text.id, text.text);
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
      data-highlight-opacity={opacityAttr(hl ? hlProgress : 0)}
      data-value-opacity={opacityAttr(writeProgress)}
      data-cx={text.x}
      data-cy={text.y}
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
          opacity={hlProgress}
        />
      )}
      <text
        x={text.x}
        y={text.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={INK}
        opacity={writeProgress}
      >
        {text.text}
      </text>
    </g>
  );
}
