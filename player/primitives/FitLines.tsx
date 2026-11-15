// A fitted value's lines (./fitText.ts) as the children of a centred <text>: one line is
// plain text; wrapped lines are tspans stacked about the text's y. A squeezed line is
// pressed to the box width with textLength, so it never leaves its box.
import { FIT_CHAR_EM, FIT_LINE_EM, type FittedText } from "./fitText";

export function FitLines({
  fitted,
  x,
  boxW,
}: {
  fitted: FittedText;
  /** The text's x (its centre, with textAnchor="middle"). */
  x: number;
  boxW: number;
}) {
  const { lines, fontSize, squeeze } = fitted;
  const press = (line: string) =>
    squeeze && [...line].length * fontSize * FIT_CHAR_EM > boxW
      ? { textLength: boxW, lengthAdjust: "spacingAndGlyphs" as const }
      : {};
  if (lines.length === 1)
    return Object.keys(press(lines[0])).length ? (
      <tspan x={x} {...press(lines[0])}>
        {lines[0]}
      </tspan>
    ) : (
      <>{lines[0]}</>
    );
  return (
    <>
      {lines.map((line, i) => (
        <tspan
          key={i}
          x={x}
          dy={`${i === 0 ? (-(lines.length - 1) / 2) * FIT_LINE_EM : FIT_LINE_EM}em`}
          {...press(line)}
        >
          {line}
        </tspan>
      ))}
    </>
  );
}
