// Easing curves for the board (issue #101). Pure functions of progress 0..1, so anything eased
// with them is still a pure function of the audio clock (ARCHITECTURE.md section 5.3).

/** Clamps to 0..1. */
export function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p));
}

/** Fast start, gentle landing: fades, rises, pen strokes. */
export function easeOutCubic(p: number): number {
  const q = 1 - clamp01(p);
  return 1 - q * q * q;
}

/** Gentle start and landing: moves. */
export function easeInOutCubic(p: number): number {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Progress of a sub-span [start, start + length] of 0..1 (0 before it, 1 after). */
export function span(p: number, start: number, length: number): number {
  return length <= 0 ? (p >= start ? 1 : 0) : clamp01((p - start) / length);
}
