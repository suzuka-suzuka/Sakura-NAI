"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */
import { useState } from "react";
import { Sparkles, Images, ImagePlus, Pencil, Eraser, Wand2, Download, Copy, Hash, Settings2, Maximize2, Pin, PinOff, RotateCcw, Trash2, Scan } from "lucide-react";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import type { GalleryImage } from "@/lib/db/gallery";
import { imageToolSettings } from "@/lib/nai/image-tools";
import { estimateCost, upscaleCost } from "@/lib/nai/cost";
import { generationSize } from "@/lib/nai/models";
import { downloadDataUrl, copyImageToClipboard } from "@/lib/image-actions";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NumericSlider } from "@/components/sidebar/official-composer";
import { EnhancePanel } from "./enhance-panel";

function PricedTool({ label, price, children, onClick, disabled }: { label: string; price: number | null; children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return <button type="button" aria-label={`${label} · ${price === null ? "—" : t("{0} points", price)}`} title={label} onClick={onClick} disabled={disabled}
    className="flex h-9 shrink-0 items-center gap-2 rounded px-2 text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px]">
    {children}<span className="flex items-center gap-1 whitespace-nowrap rounded-sm bg-surface-3 px-2 py-1 text-xs font-semibold tabular-nums">{price ?? "—"}<span className="text-[10px]">{t("points")}</span></span>
  </button>;
}

export function OfficialImageView({ batch, selected }: { batch: GalleryImage[]; selected: GalleryImage | null }) {
  useLocale();
  const img = selected ?? batch[0];
  const setUI = useStore(s => s.setUI), patch = useStore(s => s.patchSettings), restore = useStore(s => s.restoreSettings);
  const account = useStore(s => s.account), generate = useStore(s => s.generate), busy = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing);
  const client = useStore(s => s.client);
  const [upscale, setUpscale] = useState(false);
  const upscalePrice = upscaleCost(img.settings.width, img.settings.height, account);
  const beginEnhancement = useStore(s => s.beginEnhancement), closeEnhancement = useStore(s => s.closeEnhancement);
  const [variations, setVariations] = useState(false), [recipe, setRecipe] = useState(false), [strength, setStrength] = useState(0.5), [noise, setNoise] = useState(0);
  const [pinned, setPinned] = useState<GalleryImage | null>(null);
  const effective = imageToolSettings(img, "variations", { strength, noise });
  const { width, height } = effective;
  const cost = estimateCost(effective, account, client?.uncachedVibes(effective) ?? effective.vibe.length);
  const asInput = () => { closeEnhancement(); patch({ ...generationSize(img.settings.width,img.settings.height),imageSource:{ dataUrl:img.dataUrl,width:img.settings.width,height:img.settings.height,mode:"img2img",strength:0.7,noise:0,inpaintStrength:1 } }); setUI({settingsCollapsed:false}); };
  const edit = (mode: "draw" | "mask") => { closeEnhancement(); patch(generationSize(img.settings.width,img.settings.height)); setUI({imageEditor:{mode,source:img.dataUrl}}); };
  return <div className="flex h-full flex-col">
    <div className="flex shrink-0 flex-wrap justify-center px-3 py-3">
      <div className="flex flex-wrap items-center justify-center rounded border border-border-soft bg-surface px-1">
        <IconButton label={t("Enhance")} onClick={()=>beginEnhancement(img)} disabled={busy}><Sparkles /></IconButton>
        <PricedTool label={t("Variations")} price={cost.valid ? cost.total : null} onClick={()=>{closeEnhancement();setVariations(true);}} disabled={busy || !cost.valid}><Images /></PricedTool>
        <PricedTool label={t("Upscale 2×")} price={upscalePrice} onClick={()=>{closeEnhancement();setUpscale(true);}} disabled={busy || upscalePrice === null}><Scan /></PricedTool>
        <span className="mx-1 h-6 border-l border-border" />
        <IconButton label={t("Use as base image")} onClick={asInput}><ImagePlus /></IconButton>
        <IconButton label={t("Edit image")} onClick={()=>edit("draw")}><Pencil /></IconButton>
        <IconButton label={t("Inpaint")} onClick={()=>edit("mask")}><Eraser /></IconButton>
        <IconButton label={t("Director tools")} onClick={()=>setUI({showDirector:true})}><Wand2 /></IconButton>
      </div>
    </div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center gap-3 overflow-hidden px-4 pb-3">
      {pinned && pinned.id !== img.id && <div className="relative flex h-full min-w-0 flex-1 items-center justify-center"><img src={pinned.dataUrl} alt={t("Pinned image")} className="max-h-full max-w-full object-contain"/><IconButton className="absolute right-1 top-1" label={t("Unpin image")} onClick={()=>setPinned(null)}><PinOff /></IconButton></div>}
      <div className="relative flex h-full min-w-0 flex-1 items-center justify-center">
        <img src={img.dataUrl} alt={img.settings.prompt || t("Generated image")} onClick={()=>setUI({focusedIndex:Math.max(0,batch.findIndex(i=>i.id===img.id))})} className="max-h-full max-w-full cursor-zoom-in rounded object-contain" />
        <IconButton variant="overlay" label={t("Open fullscreen preview")} className="absolute right-1 top-1" onClick={()=>setUI({focusedIndex:Math.max(0,batch.findIndex(i=>i.id===img.id))})}><Maximize2 /></IconButton>
      </div>
      <EnhancePanel />
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pb-3">
      <div className="flex items-center gap-1 rounded border border-border-soft bg-surface p-1 text-xs">
        <span className="px-2">{img.settings.width} × {img.settings.height}</span>
        <IconButton size="sm" label={t("Image parameters")} onClick={()=>setRecipe(true)}><Settings2 /></IconButton>
        <button className="flex items-center gap-2 rounded bg-surface-2 px-2 py-2" title={t("Copy seed to settings")} onClick={()=>patch({seed:img.seed})}><Hash className="size-3" />{img.seed}</button>
      </div>
      <div className="flex items-center rounded border border-border-soft bg-surface p-1">
        <IconButton size="sm" label={t("Pin image for comparison")} aria-pressed={pinned?.id === img.id} onClick={()=>setPinned(pinned?.id === img.id ? null : img)}><Pin /></IconButton>
        <IconButton size="sm" label={t("Reuse settings")} onClick={()=>restore(img.settings)}><RotateCcw /></IconButton>
        <IconButton size="sm" label={t("Copy image")} onClick={()=>void copyImageToClipboard(img.dataUrl)}><Copy /></IconButton>
        <IconButton size="sm" label={t("Download")} onClick={()=>downloadDataUrl(img.dataUrl,img.filename)}><Download /></IconButton>
        <IconButton size="sm" label={t("Delete")} onClick={()=>img.id && void useStore.getState().deleteImage(img.id)}><Trash2 /></IconButton>
      </div>
    </div>
    <Modal open={variations} onClose={()=>setVariations(false)} title={t("Variations")} className="max-w-xl">
      <div className="space-y-4">
        <NumericSlider label={t("Strength")} min={0.01} max={1} step={0.01} value={strength} onChange={setStrength}/>
        <NumericSlider label={t("Noise")} min={0} max={1} step={0.01} value={noise} onChange={setNoise}/>
        <p className="text-xs text-muted">{width} × {height} · {effective.steps} {t("Steps")} · {effective.nSamples} {t("Images")}</p>
        <Button className="w-full" disabled={busy || !cost.valid} onClick={()=>{setVariations(false);void generate(undefined,effective);}}>{t("Generate variations")} · {cost.total} {t("points")}</Button>
      </div>
    </Modal>
    <Modal open={upscale} onClose={()=>setUpscale(false)} title={t("Upscale 2×")} className="max-w-sm">
      <p className="text-sm">{img.settings.width} × {img.settings.height} → {img.settings.width*2} × {img.settings.height*2}</p>
      <p className="mt-3 text-sm text-muted">{t("This operation will use {0} points.", upscalePrice ?? 0)}</p>
      <Button className="mt-5 w-full" disabled={busy || upscalePrice === null} onClick={()=>{setUpscale(false);void useStore.getState().runDirector("upscale",{source:img});}}>{t("Upscale 2×")} · {upscalePrice} {t("points")}</Button>
    </Modal>
    <Modal open={recipe} onClose={()=>setRecipe(false)} title={t("Image parameters")} className="max-w-2xl">
      <dl className="space-y-3 text-sm"><div><dt className="text-muted">{t("Prompt")}</dt><dd className="whitespace-pre-wrap break-words">{img.settings.prompt}</dd></div><div><dt className="text-muted">{t("Undesired content")}</dt><dd className="whitespace-pre-wrap break-words">{img.settings.negativePrompt}</dd></div><div className="text-muted">{img.settings.model} · {img.settings.sampler} · {img.settings.steps} {t("Steps")} · CFG {img.settings.scale}</div></dl>
      <Button className="mt-5" onClick={()=>{restore(img.settings);setRecipe(false);}}>{t("Reuse settings")}</Button>
    </Modal>
  </div>;
}
