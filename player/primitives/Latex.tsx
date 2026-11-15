// A latex object: a KaTeX formula centred on (x, y), with an optional
// whole-object highlight. The tex is model output, so it only reaches the page
// as KaTeX's own escaped HTML (KATEX_OPTIONS: trust off, sizes and macro
// expansion capped), and tex KaTeX can't render shows as an error, never a throw.
import "katex/dist/katex.min.css";
import type { ActiveAction, LatexObject, ObjectState } from "@/shared/scene";
import { renderLatex } from "./katex";
import { LATEX_FONT, LATEX_PAD } from "@/shared/boxes";
import {
  HIGHLIGHT,
  INK,
  LATEX_BOX,
  LATEX_ERROR,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
} from "./style";

export function Latex({
  latex,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  latex: LatexObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const opacity = state.visible ? fadeOpacity(active, { id: latex.id }) : 0;
  const hl = state.highlight;
  const hlProgress = objectProgress(active, "highlight", latex.id, hl);
  const { html } = renderLatex(latex.tex);
  return (
    <g
      data-object-id={latex.id}
      data-kind="latex"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-highlight={highlightAttr(hl)}
      data-highlight-opacity={opacityAttr(hl ? hlProgress : 0)}
      data-tex={latex.tex}
      data-cx={latex.x}
      data-cy={latex.y}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      <foreignObject
        x={latex.x - LATEX_BOX.w / 2}
        y={latex.y - LATEX_BOX.h / 2}
        width={LATEX_BOX.w}
        height={LATEX_BOX.h}
        overflow="visible"
        pointerEvents="none"
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              position: "relative",
              display: "inline-block",
              padding: `${LATEX_PAD.y}px ${LATEX_PAD.x}px`,
              fontSize: LATEX_FONT,
              color: INK,
            }}
          >
            {hl && (
              <span
                data-latex-highlight
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 8,
                  background: HIGHLIGHT[hl].fill,
                  border: `2px solid ${HIGHLIGHT[hl].stroke}`,
                  opacity: hlProgress,
                }}
              />
            )}
            {html !== undefined ? (
              <span
                style={{ position: "relative" }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              // KaTeX failed outright: the source as plain text, escaped by React.
              <span
                className="katex-error"
                style={{ position: "relative", color: LATEX_ERROR }}
              >
                {latex.tex}
              </span>
            )}
          </span>
        </div>
      </foreignObject>
    </g>
  );
}
