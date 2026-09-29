"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */
import { useEffect, useRef, useState } from "react";
import { Grid3X3, Minus, Plus } from "lucide-react";
import { CharacterIcon } from "@/components/character-icon";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { isV5Model } from "@/lib/nai/models";
import { useFitCanvas } from "@/lib/use-fit-canvas";

type Guide = "None" | "Thirds" | "Phi" | "Grid";
const divisions = (count: number) => Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);

export function CharacterPositions() {
  useLocale();
  const settings = useStore(s => s.settings), update = useStore(s => s.updateCharacter), setUI = useStore(s => s.setUI);
  const selected = useStore(s => s.selectedImage);
  const [active, setActive] = useState<string | number>(settings.characters[0]?.id ?? 0);
  const [guide, setGuide] = useState<Guide>("None"), [guideOpen, setGuideOpen] = useState(false);
  const [columns, setColumns] = useState(3), [rows, setRows] = useState(3);
  const dragging = useRef<number | null>(null);
  const guideMenu = useRef<HTMLDivElement>(null);
  const { container: fitContainer, size: fitSize } = useFitCanvas(settings.width, settings.height);
  const index = Math.max(0, settings.characters.findIndex((c, i) => (c.id ?? i) === active));
  const precision = isV5Model(settings.model) ? 1000 : 20;
  const coordinate = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * precision) / precision;

  useEffect(() => {
    if (!guideOpen) return;
    const outside = (e: PointerEvent) => { if (!guideMenu.current?.contains(e.target as Node)) setGuideOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [guideOpen]);

  const place = (e: React.PointerEvent<HTMLDivElement>, characterIndex: number) => {
    if (!settings.characters[characterIndex]) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    update(characterIndex, { center: { x: coordinate((e.clientX - rect.left) / rect.width), y: coordinate((e.clientY - rect.top) / rect.height) } });
  };
  const fractions = guide === "Phi" ? [1 - 1 / ((1 + Math.sqrt(5)) / 2), 1 / ((1 + Math.sqrt(5)) / 2)] : null;
  const vertical = guide === "None" ? [] : fractions ?? divisions(guide === "Grid" ? columns : 3);
  const horizontal = guide === "None" ? [] : fractions ?? divisions(guide === "Grid" ? rows : 3);

  return <section className="flex h-full min-h-0 flex-col gap-3 p-3" aria-label={t("Character positions")}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); if (guideOpen) setGuideOpen(false); else setUI({ showPositions: false }); } }}>
    <div className="flex min-h-11 shrink-0 flex-wrap justify-center gap-2" role="group" aria-label={t("Select character")}>
      {settings.characters.map((c, i) => <button key={c.id ?? i} type="button" aria-label={t("Select character {0}", i + 1)}
        title={c.name || `${t("Character")} ${i + 1}`} aria-pressed={index === i}
        onClick={() => setActive(c.id ?? i)}
        className={cn("flex h-11 min-w-[52px] items-center justify-center gap-2 rounded-sm border border-border-soft px-3 text-sm", index === i ? "bg-fg text-bg" : "bg-surface/30 text-fg-2", !c.enabled && "opacity-50")}>{i + 1}<CharacterIcon prompt={c.prompt} className="size-3.5" /></button>)}
    </div>
    <div ref={fitContainer} className="flex min-h-0 w-full flex-1 items-center justify-center">
      <div role="group" aria-label={t("Position canvas")} className="relative touch-none overflow-hidden rounded bg-surface-2" style={fitSize}
        onPointerDown={e => {
          if (e.button !== 0) return;
          const marker = (e.target as HTMLElement).closest<HTMLElement>("[data-character-index]");
          const next = marker ? Number(marker.dataset.characterIndex) : index;
          if (!settings.characters[next]) return;
          dragging.current = next;
          setActive(settings.characters[next].id ?? next);
          e.currentTarget.setPointerCapture(e.pointerId);
          if (!marker) place(e, next);
        }}
        onPointerMove={e => { if (dragging.current !== null) place(e, dragging.current); }}
        onPointerUp={e => { dragging.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { dragging.current = null; }}>
        {selected && <img src={selected.dataUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-50" />}
        {guide !== "None" && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full text-white/40">
          {vertical.map(x => <line key={`x${x}`} x1={x * 100} y1={0} x2={x * 100} y2={100} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {horizontal.map(y => <line key={`y${y}`} x1={0} y1={y * 100} x2={100} y2={y * 100} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        </svg>}
        {settings.characters.map((c, i) => <button key={c.id ?? i} type="button" data-character-index={i}
          aria-label={t("Character {0} position", i + 1)} aria-pressed={index === i}
          title={`${c.name || `${t("Character")} ${i + 1}`} · ${c.center.x}, ${c.center.y}`}
          style={{ left: `${c.center.x * 100}%`, top: `${c.center.y * 100}%`, zIndex: index === i ? 2 : 1 }}
          onClick={() => setActive(c.id ?? i)}
          onKeyDown={e => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (!delta) return;
            e.preventDefault();
            const step = (e.shiftKey ? 10 : 1) / precision;
            update(i, { center: { x: coordinate(c.center.x + delta[0] * step), y: coordinate(c.center.y + delta[1] * step) } });
          }}
          className={cn("absolute flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full text-xs shadow-sm active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent", index === i ? "bg-fg text-bg" : "bg-bg text-fg", !c.enabled && "opacity-50")}>{i + 1}</button>)}
      </div>
    </div>
    <div className="flex shrink-0 items-end justify-between gap-3">
      <div ref={guideMenu} className="relative">
        {guideOpen && <div role="group" aria-label={t("Composition guides")} className="absolute bottom-full left-0 z-10 mb-2 rounded border border-border-soft bg-surface p-1.5 shadow-xl">
          <div className="flex gap-1">{(["None", "Thirds", "Phi", "Grid"] as const).map(value => <button type="button" key={value} aria-pressed={guide === value} onClick={() => setGuide(value)} className={cn("whitespace-nowrap rounded-sm px-3 py-2 text-[13px] font-semibold", guide === value && "bg-surface-3")}>{t(value)}</button>)}</div>
          {guide === "Grid" && <div className="mt-2 flex items-center gap-3 px-1 text-xs">
            {(["Columns", "Rows"] as const).map((label, i) => <div key={label} role="group" aria-label={t(label)} className="flex items-center gap-1">
              {i === 1 && <span aria-hidden className="mr-2">×</span>}
              <IconButton label={t("Decrease {0}", t(label))} size="sm" disabled={(i ? rows : columns) <= 1} onClick={() => i ? setRows(rows - 1) : setColumns(columns - 1)}><Minus /></IconButton>
              <output aria-label={t(label)}>{i ? rows : columns}</output>
              <IconButton label={t("Increase {0}", t(label))} size="sm" disabled={(i ? rows : columns) >= 20} onClick={() => i ? setRows(rows + 1) : setColumns(columns + 1)}><Plus /></IconButton>
            </div>)}
          </div>}
        </div>}
        <IconButton label={t("Composition guides")} size="lg" aria-expanded={guideOpen} onClick={() => setGuideOpen(!guideOpen)} className="size-11 rounded bg-surface-2"><Grid3X3 /></IconButton>
      </div>
      <Button className="h-11 rounded px-5" onClick={() => setUI({ showPositions: false })}>{t("Finish editing positions")}</Button>
    </div>
  </section>;
}
