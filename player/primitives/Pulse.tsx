// The once-only ring around a highlight being set (./motion.ts highlightLook): it swells to the
// middle of the highlight and is gone by its end. `pulse` 0 draws nothing.

/** How far the ring grows past the highlight's box at its peak (px). */
export const PULSE_GROW = 5;

export function PulseRing({
  x,
  y,
  w,
  h,
  rx,
  color,
  pulse,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  color: string;
  pulse: number;
}) {
  if (pulse <= 0) return null;
  const grow = PULSE_GROW * pulse;
  return (
    <rect
      data-pulse={Math.round(pulse * 100) / 100}
      x={x - grow}
      y={y - grow}
      width={w + 2 * grow}
      height={h + 2 * grow}
      rx={rx + grow}
      fill="none"
      stroke={color}
      strokeWidth={1.5 + pulse}
      opacity={0.6 * pulse}
    />
  );
}
