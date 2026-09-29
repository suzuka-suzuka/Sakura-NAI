"use client";
/* eslint-disable @next/next/no-img-element -- User-supplied data URLs stay in the browser. */
import { useRef, useState } from "react";
import { Upload, Download, ImagePlus, Loader2 } from "lucide-react";
import { useStore, type DirectorKind } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { EMOTION_OPTIONS } from "@/lib/nai/models";
import { EmotionOptions } from "@/lib/nai/protocol";
import { parseImage } from "@/lib/nai/media";
import { augmentCost } from "@/lib/nai/cost";
import { downloadDataUrl } from "@/lib/image-actions";
import type { GalleryImage } from "@/lib/db/gallery";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { ClearPromptButton } from "@/components/ui/clear-prompt-button";
import { NumericSlider } from "@/components/sidebar/official-composer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TOOLS = [
  ["backgroundRemoval", "Remove BG"], ["lineArt", "Line art"], ["sketch", "Sketch"],
  ["colorize", "Colorize"], ["emotion", "Emotion"], ["declutter", "Declutter"], ["pixelSnap", "Pixel Snap"],
] as const;
export function DirectorModal() {
  const show = useStore(s=>s.showDirector);
  return show ? <DirectorSession /> : null;
}
function DirectorSession() {
  useLocale();
  const selected=useStore(s=>s.selectedImage), batch=useStore(s=>s.selectedBatch), settings=useStore(s=>s.settings);
  const setUI=useStore(s=>s.setUI), run=useStore(s=>s.runDirector), busy=useStore(s=>s.isDirectorProcessing || s.isGenerating || s.isPreparing);
  const account=useStore(s=>s.account), preferences=useStore(s=>s.preferences);
  const [source,setSource]=useState<GalleryImage|null>(selected), [kind,setKind]=useState<DirectorKind>("lineArt");
  const [emotion,setEmotion]=useState<EmotionOptions>(EmotionOptions.NEUTRAL), [prompt,setPrompt]=useState(""), [defry,setDefry]=useState(0);
  const [palette,setPalette]=useState("off"), [colors,setColors]=useState(64), [conservative,setConservative]=useState(false), [upscale,setUpscale]=useState(false);
  const [confirm,setConfirm]=useState(false), [approved,setApproved]=useState(false);
  const upload=useRef<HTMLInputElement>(null);
  const promptInput=useRef<HTMLTextAreaElement>(null);
  const cost=kind === "pixelSnap" ? 0 : source ? augmentCost(source.settings.width,source.settings.height,kind === "backgroundRemoval",account) : 0;
  const execute=()=>{if(!source)return; if(!cost)setApproved(false);setConfirm(false);void run(kind,{source,prompt,emotion,defry,level:defry,colors:palette === "off" ? undefined : palette === "auto" ? 64 : colors,conservative,upscale});};
  return <Modal open onClose={()=>setUI({showDirector:false})} dismissible={!busy} title={t("Director tools")} className="max-w-6xl">
    <div className="flex flex-wrap gap-1 rounded bg-bg p-1">{TOOLS.map(([value,label])=><button key={value} onClick={()=>setKind(value)} disabled={busy} className={cn("flex-1 whitespace-nowrap rounded px-3 py-2 text-xs font-semibold",kind===value ? "bg-surface-3 text-accent" : "text-muted hover:bg-surface-2")}>{t(label)}</button>)}</div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div className="relative flex h-[40vh] min-h-40 items-center justify-center overflow-hidden rounded bg-bg">
        {source ? <img src={source.dataUrl} alt={t("Input image")} className="max-h-full max-w-full object-contain"/> : <Button variant="secondary" onClick={()=>upload.current?.click()}><Upload/>{t("Upload image")}</Button>}
        <IconButton label={t("Upload image")} disabled={busy} onClick={()=>upload.current?.click()} className="absolute bottom-2 left-2 bg-surface"><Upload/></IconButton>
      </div>
      <div className="relative flex h-[40vh] min-h-40 items-center justify-center overflow-hidden rounded bg-bg">
        {selected && selected !== source && <img src={selected.dataUrl} alt={t("Output image")} className="max-h-full max-w-full object-contain"/>}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-bg/60"><Loader2 className="size-8 animate-spin text-accent"/></div>}
        {selected && selected !== source && <div className="absolute bottom-2 right-2 flex rounded bg-surface"><IconButton label={t("Use as base image")} onClick={()=>setSource(selected)}><ImagePlus/></IconButton><IconButton label={t("Download")} onClick={()=>downloadDataUrl(selected.dataUrl,selected.filename)}><Download/></IconButton></div>}
      </div>
    </div>
    {selected?.processedWith === "backgroundRemoval" && batch && batch.length > 1 && <div className="mt-2 flex justify-end gap-2">{batch.map((img,i)=><button key={img.id} className={cn("rounded border px-3 py-1 text-xs",selected.id===img.id?"border-accent":"border-border")} onClick={()=>useStore.getState().selectImage(img)}>{t("Result {0}",i+1)}</button>)}</div>}
    <input ref={upload} className="hidden" type="file" accept="image/*" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const p=await parseImage(file);setSource({dataUrl:`data:image/png;base64,${p.base64}`,timestamp:new Date().toISOString(),filename:file.name,seed:-1,settings:{...settings,width:p.width,height:p.height,imageSource:null},batchId:0,batchIndex:0,batchSize:1});}catch(err){toast.error(String(err));}finally{e.target.value="";}}}/>
    <div className="mt-4 space-y-3">
      {(kind === "colorize" || kind === "emotion") && <div className="grid gap-3 sm:grid-cols-2">
        {kind === "emotion" && <label className="space-y-1 text-xs">{t("Emotion")}<Select aria-label={t("Emotion")} value={emotion} onChange={e=>setEmotion(e.target.value as EmotionOptions)}>{EMOTION_OPTIONS.map(e=><option key={e.value} value={e.value}>{t(e.label)}</option>)}</Select></label>}
        <NumericSlider label={t("Defry")} min={0} max={5} value={defry} onChange={setDefry}/>
        <div className="space-y-1 text-xs sm:col-span-2"><span>{t("Prompt")}</span><div className="relative">
          <textarea ref={promptInput} aria-label={t("Director prompt")} rows={2} value={prompt} onChange={e=>setPrompt(e.target.value)} className="block w-full rounded bg-bg p-2 pr-10 text-sm"/>
          <ClearPromptButton label={t("Director prompt")} value={prompt} onClear={()=>{setPrompt("");promptInput.current?.focus();}} />
        </div></div>
      </div>}
      {kind === "pixelSnap" && <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2">{t("Palettize")}<Select value={palette} onChange={e=>setPalette(e.target.value)} aria-label={t("Palettize")} className="h-8 w-24"><option value="off">{t("Off")}</option><option value="auto">{t("Auto")}</option><option value="custom">{t("Custom")}</option></Select></label>
        {palette === "custom" && <label>{t("Colors")} <input aria-label={t("Colors")} type="number" min={2} max={256} value={colors} onChange={e=>setColors(Math.max(2,Math.min(256,Number(e.target.value))))} className="w-16 rounded bg-bg px-2 py-1"/></label>}
        <label><input type="checkbox" checked={conservative} onChange={e=>setConservative(e.target.checked)} className="mr-2 accent-accent"/>{t("Avoid over-refining")}</label>
        <label><input type="checkbox" checked={upscale} onChange={e=>setUpscale(e.target.checked)} className="mr-2 accent-accent"/>{t("Keep original size")}</label>
      </div>}
      {!confirm && <Button className="w-full" disabled={busy || !source} onClick={()=>cost>0 && preferences.confirmPaid && !approved ? setConfirm(true) : execute()}>{t("Transform")} · {cost} {t("points")}</Button>}
    </div>
    {confirm && <div className="mt-4 rounded border border-accent/30 bg-bg p-4" role="alert"><p className="mb-3 text-sm">{t("This operation will use {0} points.",cost)}</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setConfirm(false)}>{t("Cancel")}</Button><Button onClick={()=>{setApproved(true);execute();}}>{t("Continue")}</Button></div></div>}
  </Modal>;
}
