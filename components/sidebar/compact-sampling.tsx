"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Dices, Sprout } from "lucide-react";
import { useStore } from "@/lib/store";
import { translateUI as t } from "@/lib/i18n";
import { SAMPLER_OPTIONS, isV4Model, isV5Model } from "@/lib/nai/models";
import { IconButton } from "@/components/ui/icon-button";
import type { Sampler } from "@/lib/nai/protocol";
import { cn } from "@/lib/utils";

function InlineSampler({ value, modern, onChange }: { value: Sampler; modern: boolean; onChange: (value: Sampler) => void }) {
  const options = SAMPLER_OPTIONS.filter(o => !modern || o.value !== "ddim_v3");
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const id = useId();
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setAnchor({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: rect.top - 6 });
  };
  const choose = (sampler: Sampler) => { onChange(sampler); setAnchor(null); trigger.current?.focus(); };
  useEffect(() => {
    if (!anchor) return;
    const outside = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setAnchor(null);
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); };
  }, [anchor]);
  useEffect(() => { if (anchor) list.current?.children[active]?.scrollIntoView({ block: "nearest" }); }, [anchor, active]);
  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={t("Sampler")} aria-haspopup="listbox" aria-expanded={!!anchor}
      aria-controls={anchor ? id : undefined} aria-activedescendant={anchor ? `${id}-${active}` : undefined}
      title={options.find(o => o.value === value)?.label}
      className="min-w-0 rounded-sm text-left outline-none hover:bg-bg focus:bg-bg focus:ring-1 focus:ring-accent"
      onClick={() => anchor ? setAnchor(null) : open()}
      onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); setAnchor(null); }
        if (e.key === "Tab") setAnchor(null);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!anchor) open();
          else setActive(a => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        }
        if (anchor && (e.key === "Home" || e.key === "End")) { e.preventDefault(); setActive(e.key === "Home" ? 0 : options.length - 1); }
        if (anchor && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choose(options[active].value); }
      }}>
      <span className="block text-muted">{t("Sampler")}</span>
      <span className="flex h-7 min-w-0 items-center text-[12px] font-bold"><span className="truncate">{options.find(o => o.value === value)?.label}</span></span>
    </button>
    {anchor && createPortal(<ul ref={list} id={id} role="listbox" aria-label={t("Sampler")} tabIndex={-1}
      className="fixed z-[80] w-56 -translate-y-full overflow-y-auto overscroll-contain rounded border border-border bg-surface-3 p-1 shadow-xl"
      style={{ ...anchor, maxHeight: Math.max(0, Math.min(280, anchor.top - 8)) }} onMouseDown={e => e.preventDefault()}>
      {options.map((o, i) => <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value}
        className={cn("cursor-pointer rounded px-3 py-2 text-[13px] hover:bg-surface-2", i === active && "bg-accent/15 text-accent")}
        onClick={() => choose(o.value)}>{o.label}</li>)}
    </ul>, document.body)}
  </>;
}

function InlineNumber({ id, label, value, min, max, step = 1, emptyValue, onChange }: {
  id?: string; label: string; value: number; min: number; max: number; step?: number; emptyValue?: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(""), [editing, setEditing] = useState(false);
  const selectOnClick = useRef(false);
  const normalize = (text: string) => text.trim() === "" ? emptyValue ?? value : Math.max(min, Math.min(max, Number((Math.round(Number(text) / step) * step).toFixed(6))));
  return <input id={id} aria-label={label} title={value === -1 ? t("Random seed") : String(value)} type="number" min={min} max={max} step={step}
    value={editing ? draft : value === -1 ? "" : value} placeholder={value === -1 ? "♧" : undefined}
    onPointerDown={e => { selectOnClick.current = document.activeElement !== e.currentTarget; }}
    onFocus={e => { setDraft(value === -1 ? "" : String(value)); setEditing(true); selectOnClick.current = true; e.currentTarget.select(); }}
    // A pointer's default caret placement can undo the selection made during focus.
    // Select after the first click finishes; subsequent clicks still let users place the caret.
    onClick={e => { if (selectOnClick.current) { e.currentTarget.select(); selectOnClick.current = false; } }}
    onChange={e => { setDraft(e.target.value); const v = Number(e.target.value); if (e.target.value && Number.isFinite(v) && v >= min && v <= max) onChange(normalize(e.target.value)); }}
    onBlur={() => { const v = normalize(draft); if (Number.isFinite(v)) onChange(v); setEditing(false); }}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
    className="h-7 w-full min-w-0 appearance-textfield rounded-sm bg-transparent px-0.5 text-[12px] font-bold tabular-nums outline-none hover:bg-bg focus:bg-bg focus:ring-1 focus:ring-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />;
}

export function CompactSampling({ onExpand }: { onExpand: () => void }) {
  const seedId = useId();
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings), selected = useStore(st => st.selectedImage);
  const modern = isV5Model(s.model) || isV4Model(s.model);
  return <div aria-label={t("Quick sampling settings")} role="group" className="grid grid-cols-[38px_46px_minmax(64px,100px)_minmax(0,1fr)_20px] items-center gap-1.5 p-2.5 text-xs">
    <label className="min-w-0"><span className="block text-muted">{t("Steps")}</span><InlineNumber label={t("Steps")} value={s.steps} min={1} max={50} onChange={steps => patch({ steps })} /></label>
    <label className="min-w-0"><span className="block whitespace-nowrap text-muted">{t("Guidance")}</span><InlineNumber label={t("Prompt guidance (CFG)")} value={s.scale} min={1} max={10} step={0.1} onChange={scale => patch({ scale })} /></label>
    <div className="min-w-0"><label htmlFor={seedId} className="block text-muted">{t("Seed")}</label><div className="flex items-center">
      <InlineNumber id={seedId} label={t("Seed")} value={s.seed} min={-1} max={4294967295} emptyValue={-1} onChange={seed => patch({ seed })} />
      <IconButton label={t(s.seed < 0 ? "Use the seed of the displayed image" : "Random seed")} size="sm" className="size-5 rounded-sm [&_svg]:size-3.5" disabled={s.seed < 0 && !selected}
        onClick={() => patch({ seed: s.seed < 0 ? selected?.seed ?? -1 : -1 })}>{s.seed < 0 ? <Sprout /> : <Dices />}</IconButton>
    </div></div>
    <InlineSampler value={s.sampler} modern={modern} onChange={sampler => patch({ sampler })} />
    <IconButton label={t("Expand sampling")} aria-expanded={false} size="sm" className="w-5 rounded-sm" onClick={onExpand}><ChevronRight /></IconButton>
  </div>;
}
