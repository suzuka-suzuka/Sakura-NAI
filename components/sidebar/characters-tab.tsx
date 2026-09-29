"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, PanelsTopLeft, Check, X } from "lucide-react";
import { CharacterIcon } from "@/components/character-icon";
import type { CharacterKind } from "@/lib/nai/characters";
import { useStore } from "@/lib/store";
import { supportsCharacters, maxCharacters } from "@/lib/nai/models";
import { TagTextarea } from "./tag-textarea";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { CharacterSetting } from "@/lib/nai/types";

function AddCharacterMenu({ disabled, onAdd }: { disabled: boolean; onAdd: (kind: CharacterKind) => void }) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!anchor) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setAnchor(null); };
    const dismiss = () => setAnchor(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [anchor]);
  return <>
    <IconButton ref={trigger} label={t("Add character")} size="lg" className="rounded bg-surface-2" disabled={disabled} aria-haspopup="menu" aria-expanded={!!anchor} aria-controls={anchor ? id : undefined}
      onClick={() => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setAnchor(anchor ? null : { left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 168)), top: rect.bottom + 146 < window.innerHeight ? rect.bottom + 6 : rect.top - 146 }); }}><Plus /></IconButton>
    {anchor && createPortal(<div ref={menu} id={id} role="menu" aria-label={t("Add character")} className="fixed z-[80] w-40 rounded border border-border bg-surface p-1 shadow-xl" style={anchor}
      onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); setAnchor(null); trigger.current?.focus(); }
        if (e.key === "Tab") setAnchor(null);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll("button")];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(current + (e.key === "ArrowDown" ? 1 : 2)) % 3]?.focus();
        }
      }}>
      {(["female", "male", "other"] as const).map(kind => <button key={kind} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm hover:bg-surface-3 focus:bg-surface-3 focus:outline-none" onClick={() => { onAdd(kind); setAnchor(null); trigger.current?.focus(); }}><CharacterIcon kind={kind} className="size-4" />{t(kind === "female" ? "Female" : kind === "male" ? "Male" : "Other")}</button>)}
    </div>, document.body)}
  </>;
}

/** Both captions remain in settings; the parallel tabs only choose the visible editor. */
function CharacterPrompt({ character, index, onChange }: {
  character: CharacterSetting;
  index: number;
  onChange: (patch: Partial<CharacterSetting>) => void;
}) {
  const [polarity, setPolarity] = useState<"prompt" | "uc">("prompt");
  const id = useId();
  return <div className="min-w-0 bg-bg px-2 pb-2 pt-2.5">
    <div role="tablist" aria-label={t("Character {0} prompt type", index + 1)} className="flex items-center gap-2 px-0.5">
      {(["prompt", "uc"] as const).map(value => <button key={value} type="button" role="tab"
        id={`${id}-${value}`} aria-controls={`${id}-editor`} aria-selected={polarity === value}
        tabIndex={polarity === value ? 0 : -1}
        onClick={() => setPolarity(value)}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const next = e.key === "Home" ? "prompt" : e.key === "End" ? "uc" : polarity === "prompt" ? "uc" : "prompt";
          setPolarity(next);
          document.getElementById(`${id}-${next}`)?.focus();
        }}
        className={cn("rounded-sm px-1 py-0.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent", polarity === value ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
      >{t(value === "prompt" ? "Prompt" : "Undesired content")}</button>)}
    </div>
    <div id={`${id}-editor`} role="tabpanel" aria-labelledby={`${id}-${polarity}`}>
      <TagTextarea key={polarity} className="min-h-[62px] rounded-none border-0 bg-transparent px-1 pt-2 text-[14px] focus:shadow-none"
        aria-label={t(polarity === "prompt" ? "Character {0} prompt" : "Character {0} undesired content", index + 1)}
        value={character[polarity]} onChange={value => onChange({ [polarity]: value })} />
    </div>
  </div>;
}

export function CharactersTab() {
  useLocale();
  const characters = useStore(s => s.settings.characters);
  const model = useStore(s => s.settings.model);
  const add = useStore(s => s.addCharacter), update = useStore(s => s.updateCharacter);
  const remove = useStore(s => s.removeCharacter), move = useStore(s => s.moveCharacter);
  const setUI = useStore(s => s.setUI), patch = useStore(s => s.patchSettings);
  const useCoords = useStore(s => s.settings.useCoords), showPositions = useStore(s => s.showPositions);
  const supported = supportsCharacters(model);

  return <section id="character-prompts" tabIndex={-1} aria-label={t("Character Prompts")} className="space-y-3 border-b border-border-soft px-3 py-3 outline-none">
    <div className="rounded border border-border-soft p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">{t("Character Prompts")}</h3>
          <p className="mt-0.5 text-[12px] leading-5 text-fg-2">{t("Create a separate prompt for characters in your scene.")}</p>
        </div>
        <AddCharacterMenu disabled={!supported || characters.length >= maxCharacters(model)} onAdd={add} />
      </div>
      {!supported ? <p className="mt-3 text-xs text-muted">{t(" Multi-character prompts need a V4, V4.5 or V5 model. ")}</p> :
        <div className="mt-3 flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-fg-2">{t("Position")}</span>
          <div role="group" aria-label={t("Character position mode")} className="flex min-w-0 flex-1 items-center rounded border border-border-soft p-0.5">
            <button type="button" aria-pressed={!useCoords} onClick={() => { patch({ useCoords: false }); setUI({ showPositions: false }); }} className={cn("min-w-0 flex-1 rounded-sm py-1.5 text-[13px] font-semibold", !useCoords && "bg-surface-3")}>{t("AI’s Choice")}</button>
            <button type="button" aria-pressed={useCoords} onClick={() => patch({ useCoords: true })} className={cn("min-w-0 flex-1 rounded-l-sm py-1.5 text-[13px] font-semibold", useCoords && "bg-surface-3")}>{t("Custom")}</button>
            <IconButton label={t("Edit character positions")} size="sm" aria-pressed={showPositions} disabled={characters.length === 0}
              className={cn("size-8 rounded-l-none rounded-r-sm border-l border-border-soft", (useCoords || showPositions) && "bg-surface-3")}
              onClick={() => {
                if (!showPositions) patch({ useCoords: true });
                setUI({ showPositions: !showPositions, ...(window.matchMedia("(max-width: 1023px)").matches ? { settingsCollapsed: true } : {}) });
              }}><PanelsTopLeft /></IconButton>
          </div>
        </div>}
    </div>
    {characters.map((c, i) => <div key={c.id ?? i} className="overflow-hidden rounded border border-border-soft bg-bg">
      <div className="flex h-8 items-center border-b border-border-soft bg-surface">
        <CharacterIcon prompt={c.prompt} className="ml-2 size-3 shrink-0 text-fg-2" />
        <input aria-label={t("Character {0} name", i + 1)} value={c.name ?? `${t("Character")} ${i + 1}`} onChange={e => update(i, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent px-2 text-[13px] font-semibold text-fg-2 outline-none" />
        <IconButton label={t("Move character up")} size="sm" className="size-8 rounded-none" disabled={i === 0} onClick={() => move(i, i - 1)}><ChevronUp /></IconButton>
        <IconButton label={t("Move character down")} size="sm" className="size-8 rounded-none" disabled={i === characters.length - 1} onClick={() => move(i, i + 1)}><ChevronDown /></IconButton>
        <IconButton label={t("Enable character")} size="sm" aria-pressed={c.enabled} className="size-8 rounded-none border-l border-border-soft" onClick={() => update(i, { enabled: !c.enabled })}>{c.enabled ? <Check /> : <X className="text-muted" />}</IconButton>
        <IconButton label={t("Remove character")} size="sm" className="size-8 rounded-none border-l border-border-soft hover:text-danger" onClick={() => remove(i)}><Trash2 /></IconButton>
        <IconButton label={t(c.collapsed ? "Expand character" : "Collapse character")} size="sm" aria-expanded={!c.collapsed} className="size-8 rounded-none border-l border-border-soft" onClick={() => update(i, { collapsed: !c.collapsed })}><ChevronsUpDown /></IconButton>
      </div>
      <div className={cn(!c.enabled && "opacity-50")}>
        {c.collapsed ? <button onClick={() => update(i, { collapsed: false })} className="block w-full truncate px-3 py-2 text-left text-[13px] text-fg-2">{c.prompt || c.uc || "\u00a0"}</button> : <CharacterPrompt character={c} index={i} onChange={change => update(i, change)} />}
      </div>
    </div>)}
  </section>;
}
