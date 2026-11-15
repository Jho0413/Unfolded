"use client";
// Zooming the board on a phone (QA A10 follow-up): at 390 px a wide drawing's text is about
// 7 px, so a tap on the board (or its zoom button) shows it about 2.2x the screen's width in a
// full-screen layer that pans by dragging. The board is zoomed in place (Player.module.css
// `[data-zoom]`), not drawn a second time, so whatever board is mounted (the lesson's, Ask's,
// the Answer view) keeps its state and its clock. The lesson holds on while zoomed and goes on
// when it closes (only if the zoom held it). Close: the X, Escape, or a tap outside the board.
// Desktop (a fine pointer and a wide window) never zooms.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PlayerEvent, PlayerState } from "../machine";

/** Where the board zooms: a phone-width window or a touch screen. */
export const ZOOM_MEDIA = "(max-width: 760px), (pointer: coarse)";

/** Elements a tap on the board means to press, not to zoom. */
const INTERACTIVE = "button, a, input, textarea, select, label, [role=button]";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(ZOOM_MEDIA);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const zoomable = () => window.matchMedia(ZOOM_MEDIA).matches;

export function useBoardZoom(
  state: PlayerState,
  send: (event: PlayerEvent) => unknown,
) {
  const enabled = useSyncExternalStore(subscribe, zoomable, () => false);
  // Leaving phone width (a resize, rotating a tablet) shows the board unzoomed again; the
  // lesson stays held until the learner goes on.
  const [zoomedState, setZoomed] = useState(false);
  const zoomed = zoomedState && enabled;
  // Whether the zoom held the lesson, so closing goes on only then.
  const heldByZoom = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const open = useCallback(() => {
    if (stateRef.current.kind === "playing") {
      send({ type: "pause" });
      heldByZoom.current = true;
    }
    setZoomed(true);
  }, [send]);

  const close = useCallback(() => {
    setZoomed(false);
    if (heldByZoom.current && stateRef.current.kind === "paused")
      send({ type: "resume" });
    heldByZoom.current = false;
  }, [send]);

  // Escape closes the zoom only: captured before the Ask panel's and the lesson's own keys.
  useEffect(() => {
    if (!zoomed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [zoomed, close]);

  /** The drawing's click: zooms on a tap, and closes on a tap outside the zoomed board. */
  const onDrawingClick = useCallback(
    (e: { target: EventTarget; currentTarget: EventTarget }) => {
      if (!enabled) return;
      if (zoomed) {
        if (e.target === e.currentTarget) close();
        return;
      }
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
      open();
    },
    [enabled, zoomed, open, close],
  );

  return { enabled, zoomed, open, close, onDrawingClick };
}
