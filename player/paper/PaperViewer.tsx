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
// - A resize moves everything on the pages, so the viewer keeps the highlighted passage in view
//   through it (the pane widens as the passage is scrolled to), until the learner scrolls.
// - Text selected in the pages offers an "Ask about this" chip beside it (issue #129): the
//   chip hands the quote and its page to `onAskAbout` (./selection.ts).
// - `data-*` attributes expose the highlight for tests.
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TextLayer } from "pdfjs-dist";
import type { PaperMatch } from "./locate";
import { loadPdfjs } from "./pdf";
import { type PaperSelection, selectionQuote } from "./selection";
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
  onAskAbout,
}: {
  pages: readonly PaperPage[];
  highlight: PaperHighlight | null;
  /** The learner pressed "Ask about this" on a selection (issue #129); none: no chip. */
  onAskAbout?: (selection: PaperSelection) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The same element, for writing the test attributes (the scroll ref is only read).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [layers, setLayers] = useState<Layers>([]);
  // The highlighted passage the viewer keeps in view, until the learner scrolls.
  const followRef = useRef<HTMLElement | null>(null);

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
      followRef.current = first;
      scrollToMark(scroller, first, prefersReducedMotion() ? "auto" : "smooth");
    }
    // For tests: what is highlighted now (set here, where the marks are made).
    const data = rootRef.current?.dataset;
    if (data !== undefined) {
      data.highlightKey = highlight.key;
      data.highlightPage = String(highlight.match.page);
      data.highlightText = marks.map((m) => m.textContent).join("");
    }
    return () => {
      if (followRef.current === first) followRef.current = null;
      unmark(marks);
      if (data !== undefined)
        data.highlightKey = data.highlightPage = data.highlightText = "";
    };
  }, [highlight, pageLayers]);

  // Each resize step (every frame of the focus transition) moves the passage: put it back at
  // once, after the pages have taken their new size and before the frame is painted.
  useLayoutEffect(() => {
    const mark = followRef.current;
    const scroller = scrollRef.current;
    if (mark !== null && mark.isConnected && scroller !== null)
      scrollToMark(scroller, mark, "auto");
  }, [width]);
  const stopFollowing = () => {
    followRef.current = null;
  };

  const picked = useSelectionChip(scrollRef, onAskAbout !== undefined);

  return (
    <>
      <div
        ref={(el) => {
          scrollRef.current = el;
          rootRef.current = el;
        }}
        className={styles.scroll}
        // The learner scrolling takes over from the viewer.
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
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
              number={i + 1}
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
      {picked !== null && onAskAbout !== undefined && (
        <button
          type="button"
          className={styles.chip}
          data-testid="paper-ask-chip"
          data-below={picked.below}
          style={{ left: picked.x, top: picked.y }}
          // Pressing it mustn't clear the selection before the click lands.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            window.getSelection()?.removeAllRanges();
            onAskAbout(picked.selection);
          }}
        >
          Ask about this
        </button>
      )}
    </>
  );
});

/** Where the chip goes (px from the pane's top left) and what it asks about. */
type Picked = {
  selection: PaperSelection;
  x: number;
  y: number;
  /** Below the selection: no room above it. */
  below: boolean;
};

/** The chip's room above a selection, and its half-width, kept inside the pane. */
const CHIP_ROOM_PX = 52;
const CHIP_HALF_WIDTH_PX = 64;

/**
 * The learner's selection in the pages, as a quote and a page, with the chip's place: centred
 * above the selection (below it near the pane's top), kept inside the pane. Null with nothing
 * (or too little) selected, or a selection outside the paper.
 */
function useSelectionChip(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): Picked | null {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || scroller === null) return;
    const update = () => setPicked(readSelection(scroller));
    document.addEventListener("selectionchange", update);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      scroller.removeEventListener("scroll", update);
    };
  }, [scrollRef, enabled]);
  return enabled ? picked : null;
}

function readSelection(scroller: HTMLElement): Picked | null {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!scroller.contains(range.commonAncestorContainer)) return null;
  const quote = selectionQuote(sel.toString());
  const pageEl = closestPage(range.startContainer);
  if (quote === null || pageEl === null) return null;
  const rect = range.getBoundingClientRect();
  const pane = scroller.getBoundingClientRect();
  // Scrolled out of view: no chip.
  if (rect.bottom < pane.top || rect.top > pane.bottom) return null;
  const below = rect.top - pane.top < CHIP_ROOM_PX;
  const centre = rect.left + rect.width / 2 - pane.left;
  return {
    selection: { quote, page: Number(pageEl.dataset.page) },
    x: Math.min(
      Math.max(centre, CHIP_HALF_WIDTH_PX + 8),
      pane.width - CHIP_HALF_WIDTH_PX - 8,
    ),
    y: Math.min(
      below ? rect.bottom - pane.top + 8 : rect.top - pane.top - 8,
      pane.height - 8,
    ),
    below,
  };
}

function closestPage(node: Node): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  return el?.closest<HTMLElement>("[data-page]") ?? null;
}

function PdfPage({
  number,
  page,
  width,
  root,
  onLayer,
}: {
  /** 1-based, for a selection's page. */
  number: number;
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
      data-page={number}
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

/** Scrolls the pane so the mark sits a third of the way down it. */
function scrollToMark(
  scroller: HTMLElement,
  mark: HTMLElement,
  behavior: ScrollBehavior,
): void {
  const box = scroller.getBoundingClientRect();
  const top = mark.getBoundingClientRect().top - box.top;
  scroller.scrollTo({
    top: scroller.scrollTop + top - box.height / 3,
    behavior,
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
