"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */

import { useId, useRef, useState } from "react";
import { ArrowLeftRight, Expand, Pencil, Upload, Trash2, RectangleHorizontal, RectangleVertical, Square, ImagePlus, Eraser, PanelTopClose, PanelTopOpen } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { MODEL_OPTIONS, modelLabel, isV5Model, isV4Model, SIZE_TIERS, presetDims, tierAspectForSize, maxSamples, generationSize } from "@/lib/nai/models";
import { QUALITY_PRESETS, NEGATIVE_PRESETS, qualityPreset, type NegativePreset, type QualityPreset } from "@/lib/nai/presets";
import { parseImage } from "@/lib/nai/media";
import { TagTextarea } from "./tag-textarea";
import { PresetSelect } from "./preset-select";
import { CharactersTab } from "./characters-tab";
import { ReferenceUploader } from "./reference-uploader";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export function NumericSlider({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void;
}) {
  return <label className="block space-y-2 text-[13px] font-semibold">
    <span>{label}</span>
    <span className="flex items-center gap-4">
      <input aria-label={label} type="number" min={min} max={max} step={step} value={value}
        onChange={e => { if (e.target.value) onChange(Math.min(max, Math.max(min, Number(e.target.value)))); }}
        className="w-16 rounded border border-border-soft bg-bg px-2 py-1.5 text-center font-normal outline-none focus:border-accent" />
      <input aria-label={`${label} ${t("Slider")}`} type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} className="nai-range min-w-0 flex-1" />
    </span>
  </label>;
}

function PromptBox({ negative = false, combined = false, onSelect, onToggleLayout }: {
  negative?: boolean;
  combined?: boolean;
  onSelect?: (negative: boolean) => void;
  onToggleLayout: () => void;
}) {
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const value = negative ? s.negativePrompt : s.prompt;
  const label = t(negative ? "Undesired content" : "Prompt");
  const setValue = (value: string) => patch(negative ? { negativePrompt: value } : { prompt: value });
  const editor = (large = false) => <TagTextarea key={negative ? "uc" : "prompt"} id={large ? undefined : negative ? "uc" : "prompt"} aria-label={label}
    value={value} onChange={setValue} className={cn("border-0 bg-transparent px-3 text-[14px] leading-7 focus:shadow-none", large ? "min-h-[45vh]" : negative && !combined ? "min-h-[106px]" : "min-h-[120px]")} />;
  return <div className={cn("nai-prompt", negative && !combined && "border-t border-dashed border-border")}>
    <div className="flex items-center justify-between px-3 pt-2.5">
      {combined ? <div className="flex min-w-0 items-center">
        <div role="tablist" aria-label={t("Main prompt type")} className="flex min-w-0 items-center gap-1">
          {[false, true].map(isNegative => <button key={String(isNegative)} type="button" role="tab"
            id={`${id}-${isNegative}`} aria-controls={`${id}-editor`} aria-selected={negative === isNegative} tabIndex={negative === isNegative ? 0 : -1}
            onClick={() => onSelect?.(isNegative)}
            onKeyDown={e => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === "Home" ? false : e.key === "End" ? true : !negative;
              onSelect?.(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
            className={cn("rounded-sm px-1 py-0.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent", negative === isNegative ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
          >{t(isNegative ? "Undesired content" : "Prompt")}</button>)}
        </div>
        {negative && <IconButton data-prompt-layout-toggle label={t("Separate prompt fields")} size="sm" className="size-6 rounded-sm bg-surface-3" onClick={onToggleLayout}><PanelTopOpen /></IconButton>}
      </div> : <span className="text-[13px] font-semibold">{label}</span>}
      <div className="flex shrink-0">
        {negative && !combined && <IconButton data-prompt-layout-toggle label={t("Combine prompt fields")} size="sm" onClick={onToggleLayout}><PanelTopClose /></IconButton>}
        <IconButton label={t("Expand prompt")} size="sm" onClick={() => setExpanded(true)}><Expand /></IconButton>
      </div>
    </div>
    <div id={`${id}-editor`} role={combined ? "tabpanel" : undefined} aria-labelledby={combined ? `${id}-${negative}` : undefined}>
      {editor()}
      <div className="flex min-h-9 items-center justify-between gap-2 px-3 pb-2">
        {!negative && isV5Model(s.model) ? <label className="flex cursor-pointer items-center gap-1 rounded-full bg-surface/60 px-2 py-0.5 text-[11px] text-muted">
          <input type="checkbox" checked={s.transparentBackground} onChange={e => patch({ transparentBackground: e.target.checked })} className="accent-accent" />{t("Transparent background")}
        </label> : <span />}
        {negative ? <PresetSelect label={t("Undesired content preset")} prefix={t("Negative tags")} value={String(s.ucPreset)} options={NEGATIVE_PRESETS} onChange={v => patch({ ucPreset: Number(v) as NegativePreset })} /> :
          <PresetSelect label={t("Quality tags preset")} prefix={t("Quality tags")} value={qualityPreset(s)} options={QUALITY_PRESETS} onChange={v => patch({ qualityPreset: v as QualityPreset, qualityToggle: v !== "none" })} />}
      </div>
    </div>
    <Modal open={expanded} onClose={() => setExpanded(false)} title={label} className="max-w-3xl">{editor(true)}</Modal>
  </div>;
}

function PromptSection() {
  const combined = useStore(st => st.combinedPrompts), setUI = useStore(st => st.setUI);
  const negative = useStore(st => st.negativePromptActive);
  const section = useRef<HTMLDivElement>(null);
  const toggleLayout = () => {
    setUI({ combinedPrompts: !combined, negativePromptActive: false });
    // The merge button unmounts; move keyboard focus to the resulting tabs or split layout.
    requestAnimationFrame(() => section.current?.querySelector<HTMLButtonElement>(combined ? "[data-prompt-layout-toggle]" : '[role="tab"][aria-selected="true"]')?.focus());
  };
  return <div ref={section} className="mx-3 overflow-hidden rounded border border-border-soft bg-bg">
    <PromptBox negative={combined && negative} combined={combined} onSelect={negativePromptActive => setUI({ negativePromptActive })} onToggleLayout={toggleLayout} />
    {!combined && <PromptBox negative onToggleLayout={toggleLayout} />}
  </div>;
}

export function ImageInputPanel() {
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings), setUI = useStore(st => st.setUI);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const source = s.imageSource;
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseImage(file);
      patch({ imageSource: { dataUrl: `data:image/png;base64,${parsed.base64}`, width: parsed.width, height: parsed.height, mode: "img2img", strength: 0.7, noise: 0, inpaintStrength: 1 }, ...generationSize(parsed.width, parsed.height) });
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <section className="space-y-3 px-3 py-4">
    <h3 className="text-[12px] text-muted">{t("Reference images")}</h3>
    <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => void upload(e.target.files?.[0])} aria-label={t("Upload base image")} />
    <div className="rounded border border-border-soft p-2.5">
      <div className="flex items-center gap-3">
        {source ? <img src={source.dataUrl} alt={t("Base image")} className="h-20 w-14 rounded object-contain" /> : <ImagePlus className="size-6 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <span>{t(source?.mode === "infill" ? "Inpaint" : "Image2Image")}</span>
            {source && <button className="text-[11px] text-muted hover:text-fg" onClick={() => source.mode === "infill" ? patch({ imageSource: { ...source, mode: "img2img" } }) : setUI({ imageEditor: { mode: "mask", source: source.dataUrl } })}>{t(source.mode === "infill" ? "Image2Image" : "Inpaint")}</button>}
          </div>
          {!source && <p className="text-[11px] text-muted">{t("Transform your image.")}</p>}
        </div>
        <IconButton label={t("Upload base image")} disabled={busy} size="sm" onClick={() => input.current?.click()}><Upload /></IconButton>
        <IconButton label={t("Edit image")} size="sm" onClick={() => setUI({ imageEditor: { mode: source?.mode === "infill" ? "mask" : "draw", source: source?.dataUrl ?? null } })}><Pencil /></IconButton>
        {source && <IconButton label={t("Remove base image")} size="sm" onClick={() => patch({ imageSource: null })}><Trash2 /></IconButton>}
      </div>
      {source && <div className="mt-4 space-y-4">
        <NumericSlider label={t("Strength")} min={0.01} max={1} step={0.01} value={source.mode === "infill" ? source.inpaintStrength : source.strength} onChange={v => patch({ imageSource: { ...source, ...(source.mode === "infill" ? { inpaintStrength: v } : { strength: v }) } })} />
        {source.mode === "img2img" && <NumericSlider label={t("Noise")} min={0} max={1} step={0.01} value={source.noise} onChange={noise => patch({ imageSource: { ...source, noise } })} />}
        {source.mode === "infill" && <button className="flex items-center gap-2 text-xs text-fg-2" onClick={() => setUI({ imageEditor: { mode: "mask", source: source.dataUrl } })}><Eraser className="size-3" />{t("Edit mask")}</button>}
        {source.mode === "infill" && <label className="block text-xs"><input type="checkbox" className="mr-2 accent-accent" checked={source.focused ?? false} onChange={e=>patch({ imageSource:{...source,focused:e.target.checked},...(e.target.checked?{width:1024,height:1024}:{}) })} />{t("Focused inpainting")}
          {source.focused && <span className="mt-1 block text-muted">{t("Upscale the masked region for detail, then paste it back. The rest of the image stays intact.")}</span>}</label>}
      </div>}
    </div>
    {!isV5Model(s.model) && <details open={s.vibe.length > 0} className="rounded border border-border-soft p-2.5"><summary className="cursor-pointer text-sm font-semibold">{t("Vibe transfer")}</summary><ReferenceUploader field="vibe" emptyLabel={t("Transfer the vibe of reference images.")} /></details>}
    {s.model.includes("4-5") && <details open={s.directorReference.length > 0} className="rounded border border-border-soft p-2.5"><summary className="cursor-pointer text-sm font-semibold">{t("Director / character reference")}</summary><ReferenceUploader field="directorReference" emptyLabel={t("Guide character features from a reference.")} /></details>}
  </section>;
}

export function OfficialComposer() {
  useLocale();
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings);
  const [tier, aspect] = tierAspectForSize(s.width, s.height);
  const setSize = (nextTier: string, nextAspect: string) => { const p = presetDims(nextTier, nextAspect); if (p) patch({ width: p.w, height: p.h }); };
  return <>
    <div className="flex items-center gap-2 px-3 py-3">
      <span className="text-[13px] text-fg-2">{t("Model")}</span>
      <div className="min-w-0 flex-1"><Select aria-label={t("Model")} value={s.model} onChange={e => patch({ model: e.target.value as typeof s.model })} className="h-9 rounded text-[13px]">
        {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{modelLabel(o.value).replace("NAI Diffusion ", "")}</option>)}
      </Select></div>
      {(isV5Model(s.model) || isV4Model(s.model)) && <button aria-label={t("Prompt mode")} title={t("Furry mode adds fur dataset at the start of the prompt.")} className="shrink-0 rounded bg-surface-2 px-2 py-2 text-xs" onClick={()=>patch({promptMode:s.promptMode === "furry" ? "anime" : "furry"})}>{s.promptMode === "furry" ? "Furry" : "Anime"}</button>}
    </div>
    <PromptSection />
    <CharactersTab />
    <ImageInputPanel />
    <section className="space-y-3 px-3 pb-5">
      <h3 className="text-[12px] text-muted">{t("Image settings")}</h3>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{t("Resolution")}</span>
        <div className="flex items-center rounded bg-surface-2">
          <input aria-label={t("Width")} type="number" min={64} max={2048} step={64} value={s.width} onChange={e => patch({ width: Number(e.target.value) })}
            onBlur={e => patch({ width: Math.max(64, Math.min(2048, Math.round(Number(e.target.value) / 64) * 64)) })} className="w-16 bg-transparent p-1 text-center text-xs outline-none" />
          <IconButton size="sm" label={t("Swap width and height")} onClick={() => patch({ width: s.height, height: s.width })}><ArrowLeftRight className="size-3" /></IconButton>
          <input aria-label={t("Height")} type="number" min={64} max={2048} step={64} value={s.height} onChange={e => patch({ height: Number(e.target.value) })}
            onBlur={e => patch({ height: Math.max(64, Math.min(2048, Math.round(Number(e.target.value) / 64) * 64)) })} className="w-16 bg-transparent p-1 text-center text-xs outline-none" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select aria-label={t("Resolution category")} className="h-9 w-28 rounded px-2 text-xs" value={tier ?? "custom"} onChange={e => setSize(e.target.value, aspect ?? "portrait")}>
          {SIZE_TIERS.map(v => <option key={v} value={v}>{t(v.charAt(0).toUpperCase() + v.slice(1))}</option>)}<option value="custom">{t("Custom")}</option>
        </Select>
        <div className="flex flex-1 rounded bg-surface-2 p-1">
          {([["landscape", RectangleHorizontal], ["portrait", RectangleVertical], ["square", Square]] as const).map(([a, Icon]) => <button key={a} aria-label={t(a.charAt(0).toUpperCase() + a.slice(1))} aria-pressed={aspect === a} disabled={tier === "wallpaper" && a === "square"} onClick={() => setSize(tier ?? "normal", a)} className={cn("flex h-7 flex-1 items-center justify-center rounded disabled:opacity-30", aspect === a && "bg-surface-3")}><Icon className="size-4" /></button>)}
        </div>
      </div>
      {s.imageSource?.mode === "infill" && <p className="text-xs text-muted">{t("The image and mask resize together to this output resolution.")}</p>}
      <div className="text-sm font-semibold">{t("Number of images")}</div>
      <div className="flex gap-1 rounded border border-border-soft bg-bg p-1">
        {Array.from({ length: maxSamples(s.model, s.width, s.height) }, (_, i) => i + 1).map(n => <button key={n} aria-label={t("Generate {0} images", n)} aria-pressed={s.nSamples === n} onClick={() => patch({ nSamples: n })} className={cn("h-8 flex-1 rounded text-sm", s.nSamples === n ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface")}>{n}</button>)}
      </div>
    </section>
  </>;
}
