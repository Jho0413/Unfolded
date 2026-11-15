// A text object, centred on (x, y), with an optional whole-object highlight.
// It rises and fades in while shown (./motion.ts); a new highlight pulses once.
import type { ActiveAction, ObjectState, TextObject } from "@/shared/scene";
import { TEXT_SIZE, textBox } from "@/shared/boxes";
import {
  HIGHLIGHT,
  INK,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
} from "./style";
import {
  appearance,
  highlightLook,
  useReducedMotion,
  writeOpacity,
} from "./motion";
import { PulseRing } from "./Pulse";

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
  const { w: boxW, h: boxH } = textBox(text.text, fontSize);
  const hlProgress = objectProgress(active, "highlight", text.id, hl);
  const writeProgress = objectProgress(active, "write", text.id, text.text);
  const reduced = useReducedMotion();
  const look = appearance(
    active,
    { id: text.id },
    state.visible,
    "text",
    reduced,
  );
  const hlLook = highlightLook(hlProgress, reduced);
  const box = { x: text.x - boxW / 2, y: text.y - boxH / 2, w: boxW, h: boxH };
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
      opacity={look.opacity}
      visibility={state.visible ? undefined : "hidden"}
      transform={look.rise > 0 ? `translate(0 ${look.rise})` : undefined}
    >
      {hl && (
        <>
          <rect
            className="wb-glow"
            style={{ ["--hl" as string]: HIGHLIGHT[hl].stroke }}
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={10}
            fill={HIGHLIGHT[hl].fill}
            stroke={HIGHLIGHT[hl].stroke}
            strokeWidth={1.75}
            opacity={hlLook.opacity}
          />
          <PulseRing
            {...box}
            rx={10}
            color={HIGHLIGHT[hl].stroke}
            pulse={hlLook.pulse}
          />
        </>
      )}
      <text
        x={text.x}
        y={text.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={INK}
        opacity={writeOpacity(writeProgress, reduced)}
      >
        {text.text}
      </text>
    </g>
  );
}
