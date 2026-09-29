"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { translateUI, useLocale } from "@/lib/i18n";
import { focusRing } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Size to the selected label, not the longest option. The tooltip escapes the scrollable sidebar. */
export function PresetSelect({ label, prefix, value, options, onChange }: {
  label: string; prefix: string; value: string; options: { value: string | number; label: string; text: string }[];
  onChange: (value: string) => void;
}) {
  useLocale();
  const id = useId();
  const trigger = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; above: boolean; maxHeight: number } | null>(null);
  const open = hovered || focused;
  const chosen = options.find(o => String(o.value) === value);
  const content = chosen?.text || translateUI("No preset tags are added.");
  const optionLabel = (text: string) => `${prefix}: ${translateUI(text)}`;
  const measure = useCallback(() => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const below = window.innerHeight - r.bottom - 16;
    const above = below < 220 && r.top > below;
    setAnchor({ x, y: above ? r.top - 8 : r.bottom + 8, above,
      // Keep exact centering even near the viewport edge by narrowing the tooltip.
      width: Math.max(1, Math.min(320, 2 * (x - 24), 2 * (document.documentElement.clientWidth - x - 24))),
      maxHeight: Math.max(80, above ? r.top - 16 : below) });
  }, []);
  useEffect(() => {
    if (!open) return;
    const observer = new ResizeObserver(measure);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);
  return <div ref={trigger} className="relative inline-grid max-w-full align-middle text-[11.5px] font-medium" data-testid="preset-select"
    onMouseEnter={() => { measure(); setHovered(true); }} onMouseLeave={() => setHovered(false)}
    onFocus={() => { measure(); setFocused(true); }} onBlur={() => setFocused(false)}>
    <span aria-hidden className="invisible whitespace-nowrap py-1 pl-2.5 pr-7">{optionLabel(chosen?.label ?? "Off")}</span>
    <select aria-label={label} aria-describedby={open ? id : undefined} value={value} onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === "Escape") { setHovered(false); setFocused(false); } }}
      className={cn("absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full border-0 bg-surface-3 pl-2.5 pr-7 text-inherit text-fg-2 outline-none hover:text-fg", focusRing)}>
      {options.map(p => <option key={p.value} value={p.value}>{optionLabel(p.label)}</option>)}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
    {open && anchor && createPortal(<div id={id} role="tooltip" data-testid="preset-tooltip"
      className="pointer-events-none fixed z-[80] overflow-y-auto whitespace-normal break-words rounded-lg border border-border bg-surface p-3 text-[12px] font-normal leading-relaxed text-fg shadow-[var(--shadow-panel)]"
      style={{ left: anchor.x, top: anchor.y, width: "max-content", maxWidth: anchor.width, maxHeight: anchor.maxHeight, transform: `translate(-50%, ${anchor.above ? "-100%" : "0"})` }}>
      {content}
    </div>, document.body)}
  </div>;
}
