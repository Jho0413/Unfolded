"use client";
// The paper beside the whiteboard (issue #98, ARCHITECTURE.md section 5.6): the PDF's pages,
// each a canvas under a pdf.js text layer, scaled to the pane's width. `highlight` marks a
// passage found by player/paper/locate.ts in the text layer, fades it in, and scrolls it to
// the middle of the pane; a new highlight replaces the previous one.
//
// - Pages are sized from the start (from their PDF size), and a canvas is drawn once its page
//   nears the view, so a long paper costs little. Text layers are made for every page, so a
//   highlight can land anywhere.
// - The pane's width sets `--total-scale-factor` (the text layer's CSS scale); a resize (the
//   focus transition) only restyles, it never redraws.
// - `data-*` attributes expose the highlight for tests.
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TextLayer } from "pdfjs-dist";
import type { PaperMatch } from "./locate";
import { loadPdfjs } from "./pdf";
import type { PaperPage } from "./usePaperDoc";
import styles from "./PaperViewer.module.css";

export type PaperHighlight = {
  /** Changes when the passage does, so the same passage again isn't re-scrolled. */
  key: string;
  match: PaperMatch;
  /** A lesson passage (the accent) or one from a question (the answer blue). */
  tone: "lesson" | "answer";
};

/** Each page's text layer spans, once drawn (index = page - 1). */
type Layers = (HTMLElement[] | undefined)[];

/** The canvas resolution: this many CSS pixels wide at most, times the device pixel ratio. */
const CANVAS_CSS_WIDTH = 1000;
const MAX_PIXEL_RATIO = 2;
const PAGE_GAP_PX = 12;

/** Memoised: the lesson page re-renders every frame while it plays. */
export const PaperViewer = memo(function PaperViewer({
  pages,
  highlight,
}: {
  pages: readonly PaperPage[];
  highlight: PaperHighlight | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The same element, for writing the test attributes (the scroll ref is only read).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [layers, setLayers] = useState<Layers>([]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pageLayers = highlight ? layers[highlight.match.page - 1] : undefined;
  useEffect(() => {
    if (highlight === null || pageLayers === undefined) return;
    const marks = markRanges(pageLayers, highlight);
    const first = marks[0];
    const scroller = scrollRef.current;
    if (first !== undefined && scroller !== null) {
      const box = scroller.getBoundingClientRect();
      const top = first.getBoundingClientRect().top - box.top;
      scroller.scrollTo({
        top: scroller.scrollTop + top - box.height / 3,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
    // For tests: what is highlighted now (set here, where the marks are made).
    const data = rootRef.current?.dataset;
    if (data !== undefined) {
      data.highlightKey = highlight.key;
      data.highlightPage = String(highlight.match.page);
      data.highlightText = marks.map((m) => m.textContent).join("");
    }
    return () => {
      unmark(marks);
      if (data !== undefined)
        data.highlightKey = data.highlightPage = data.highlightText = "";
    };
  }, [highlight, pageLayers]);

  return (
    <div
      ref={(el) => {
        scrollRef.current = el;
        rootRef.current = el;
      }}
      className={styles.scroll}
      data-testid="paper"
      data-pages={pages.length}
      // Filled in by the highlight effect (React never changes these after mount).
      data-highlight-key=""
      data-highlight-page=""
      data-highlight-text=""
    >
      {width > 0 &&
        pages.map((page, i) => (
          <PdfPage
            key={i}
            page={page}
            width={width}
            root={scrollRef}
            onLayer={(spans) =>
              setLayers((prev) => {
                const next = [...prev];
                next[i] = spans;
                return next;
              })
            }
          />
        ))}
    </div>
  );
});

function PdfPage({
  page,
  width,
  root,
  onLayer,
}: {
  page: PaperPage;
  width: number;
  root: React.RefObject<HTMLDivElement | null>;
  onLayer: (spans: HTMLElement[]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLayerRef = useRef(onLayer);
  useEffect(() => {
    onLayerRef.current = onLayer;
  });

  // The text layer, once per page.
  useEffect(() => {
    const container = textRef.current;
    if (container === null) return;
    let layer: TextLayer | null = null;
    let cancelled = false;
    void loadPdfjs().then(async (pdfjs) => {
      if (cancelled) return;
      layer = new pdfjs.TextLayer({
        textContentSource: page.textContent,
        container,
        viewport: page.proxy.getViewport({ scale: 1 }),
      });
      await layer.render();
      if (!cancelled) onLayerRef.current(layer.textDivs);
    });
    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [page]);

  // The canvas, once the page nears the view.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (box === null || canvas === null) return;
    let task: ReturnType<PaperPage["proxy"]["render"]> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const viewport = page.proxy.getViewport({
          scale: (CANVAS_CSS_WIDTH / page.width) * ratio,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.proxy.render({ canvas, viewport });
        task.promise.catch(() => {}); // cancelled on unmount
      },
      { root: root.current, rootMargin: "800px 0px" },
    );
    observer.observe(box);
    return () => {
      observer.disconnect();
      task?.cancel();
    };
  }, [page, root]);

  const scale = width / page.width;
  return (
    <div
      ref={boxRef}
      className={styles.page}
      style={
        {
          width,
          height: Math.floor(page.height * scale),
          marginBottom: PAGE_GAP_PX,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      <div ref={textRef} className={styles.textLayer} />
    </div>
  );
}

/**
 * Wraps each range's characters of its span in a <mark>, keeping the span's text (and so its
 * layout) the same. Returns the marks.
 */
function markRanges(
  spans: readonly HTMLElement[],
  highlight: PaperHighlight,
): HTMLElement[] {
  const marks: HTMLElement[] = [];
  for (const { item, start, end } of highlight.match.ranges) {
    const span = spans[item];
    if (span === undefined) continue;
    const text = span.textContent ?? "";
    const mark = document.createElement("mark");
    mark.className = styles.mark;
    mark.dataset.tone = highlight.tone;
    mark.textContent = text.slice(start, end);
    span.replaceChildren(text.slice(0, start), mark, text.slice(end));
    marks.push(mark);
  }
  return marks;
}

/** Puts each marked span's text back as one text node. */
function unmark(marks: readonly HTMLElement[]): void {
  for (const mark of marks) {
    const span = mark.parentElement;
    if (span !== null) span.textContent = span.textContent;
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
