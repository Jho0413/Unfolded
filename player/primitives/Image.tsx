"use client";
// A fal illustration (E1, issue #152): the picture at `mediaUrl`, fitted inside its box (as
// preserveAspectRatio="xMidYMid meet" would), in a rounded frame in the board's look. It rises
// and fades in while shown (./motion.ts), as text does; a whole-object highlight frames it.
//
// - No `mediaUrl` (the server hasn't saved one, or it failed): nothing is drawn.
// - The picture is loaded first, for its size, so the frame fits the picture, not the box; it
//   shows once loaded. A picture that fails to load is hidden.
//
// A client component, for that loading state: the rest of the board stays a pure render.
import { useEffect, useId, useState } from "react";
import type { ActiveAction, ImageObject, ObjectState } from "@/shared/scene";
import { appearance, highlightLook, motionProps } from "./motion";
import { PulseRing } from "./Pulse";
import {
  FRAME_BORDER,
  HIGHLIGHT,
  fadeOpacity,
  highlightAttr,
  objectProgress,
  opacityAttr,
} from "./style";

/** The frame's corner radius (board px). */
export const IMAGE_RADIUS = 12;

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The largest rect of `aspect` (width / height) that fits inside `box`, centred in it: where a
 * picture of that aspect is drawn. A bad aspect (0, NaN, Infinity) fills the box.
 */
export function fitBox(box: Rect, aspect: number): Rect {
  if (!(aspect > 0 && Number.isFinite(aspect))) return box;
  if (box.w / box.h > aspect) {
    const w = box.h * aspect;
    return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
  }
  const h = box.w / aspect;
  return { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h };
}

type Loaded = { url: string; aspect: number } | { url: string; failed: true };

export function BoardImage({
  image,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  image: ImageObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const url = image.mediaUrl;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const clipId = `wb-img-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  useEffect(() => {
    if (url === undefined) return;
    const probe = new window.Image();
    probe.onload = () =>
      setLoaded({ url, aspect: probe.naturalWidth / probe.naturalHeight });
    probe.onerror = () => setLoaded({ url, failed: true });
    probe.src = url;
    return () => {
      probe.onload = probe.onerror = null;
    };
  }, [url]);
  if (url === undefined) return null;

  const mine = loaded?.url === url ? loaded : null;
  const status =
    mine === null ? "loading" : "failed" in mine ? "failed" : "ready";
  const box = { x: image.x, y: image.y, w: image.w, h: image.h };
  const fit = mine && "aspect" in mine ? fitBox(box, mine.aspect) : box;
  const opacity = state.visible ? fadeOpacity(active, { id: image.id }) : 0;
  const look = appearance(active, { id: image.id }, state.visible, "text");
  const hl = state.highlight;
  const hlProgress = objectProgress(active, "highlight", image.id, hl);
  const hlLook = highlightLook(hlProgress);
  return (
    <g
      data-object-id={image.id}
      data-kind="image"
      data-status={status}
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-highlight={highlightAttr(hl)}
      data-highlight-opacity={opacityAttr(hl ? hlProgress : 0)}
      data-fit={[fit.x, fit.y, fit.w, fit.h]
        .map((n) => +n.toFixed(1))
        .join(" ")}
      opacity={look.opacity}
      {...motionProps(look)}
      visibility={state.visible && status === "ready" ? undefined : "hidden"}
      transform={look.rise > 0 ? `translate(0 ${look.rise})` : undefined}
    >
      {status === "ready" && (
        <>
          <clipPath id={clipId}>
            <rect
              x={fit.x}
              y={fit.y}
              width={fit.w}
              height={fit.h}
              rx={IMAGE_RADIUS}
            />
          </clipPath>
          <image
            href={url}
            x={fit.x}
            y={fit.y}
            width={fit.w}
            height={fit.h}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={image.prompt}
            clipPath={`url(#${clipId})`}
            onError={() => setLoaded({ url, failed: true })}
          />
          <rect
            x={fit.x}
            y={fit.y}
            width={fit.w}
            height={fit.h}
            rx={IMAGE_RADIUS}
            fill="none"
            stroke={FRAME_BORDER}
            strokeWidth={2}
          />
          {hl && (
            <>
              <rect
                {...motionProps(hlLook, "wb-glow", {
                  "--hl": HIGHLIGHT[hl].stroke,
                })}
                x={fit.x - 6}
                y={fit.y - 6}
                width={fit.w + 12}
                height={fit.h + 12}
                rx={IMAGE_RADIUS + 6}
                fill="none"
                stroke={HIGHLIGHT[hl].stroke}
                strokeWidth={3}
                opacity={hlLook.opacity}
              />
              <PulseRing
                x={fit.x - 6}
                y={fit.y - 6}
                w={fit.w + 12}
                h={fit.h + 12}
                rx={IMAGE_RADIUS + 6}
                color={HIGHLIGHT[hl].stroke}
                pulse={hlLook.pulse}
              />
            </>
          )}
        </>
      )}
    </g>
  );
}
