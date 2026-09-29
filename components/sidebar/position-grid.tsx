"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Click/drag to place a character's center as (x,y) in 0..1.
 *
 * Keyboard access comes from two sr-only native range inputs rather than a hand-rolled keydown
 * handler: that buys arrow keys, Page steps, Home/End and spoken value announcements from the
 * platform, all correct by default. The visible grid is a pure pointer affordance that renders
 * their state.
 */
export function PositionGrid({
  center,
  onChange,
  label,
  step = 0.05,
}: {
  center: { x: number; y: number };
  onChange: (c: { x: number; y: number }) => void;
  /** Distinguishes one character's pad from the next for screen readers. */
  label: string;
  step?: number;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);

  const pick = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onChange({ x: round(x), y: round(y) });
  };

  const round = (v: number) => Number((Math.round(v / step) * step).toFixed(3));
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "relative aspect-[3/4] w-full cursor-crosshair overflow-hidden rounded-[var(--radius-input)] border border-border bg-surface-2",
        // The range inputs are sr-only, so without a container ring focus would appear to vanish
        // into a non-interactive box for a sighted keyboard user.
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface",
      )}
      ref={ref}
      onPointerDown={(e) => {
        // currentTarget, not target: grabbing the dot used to capture the pointer on the dot itself.
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e.clientX, e.clientY);
      }}
      style={{
        backgroundImage:
          "linear-gradient(var(--border-soft) 1px, transparent 1px), linear-gradient(90deg, var(--border-soft) 1px, transparent 1px)",
        backgroundSize: "20% 20%",
      }}
    >
      <input
        type="range"
        className="sr-only"
        min={0}
        max={1}
        step={step}
        value={center.x}
        aria-label={translateUI("Horizontal position")}
        aria-valuetext={translateUI("{0} from left", pct(center.x))}
        onChange={(e) => onChange({ ...center, x: Number(e.target.value) })}
      />
      <input
        type="range"
        className="sr-only"
        min={0}
        max={1}
        step={step}
        value={center.y}
        aria-label={translateUI("Vertical position")}
        aria-valuetext={translateUI("{0} from top", pct(center.y))}
        onChange={(e) => onChange({ ...center, y: Number(e.target.value) })}
      />
      <div
        aria-hidden
        // `border-white` was hardcoded and read as a grey smudge on the light-mode surface.
        className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-[var(--shadow-card)]"
        style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
      />
    </div>
  );
}
