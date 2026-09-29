"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Lock, LockOpen, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export function HistoryPanel() {
  useLocale();
  const images = useStore(s => s.images), selected = useStore(s => s.selectedImage), status = useStore(s => s.galleryStatus);
  const selectBatch = useStore(s => s.selectBatch), selectImage = useStore(s => s.selectImage), setUI = useStore(s => s.setUI);
  const remove = useStore(s => s.deleteImage), clear = useStore(s => s.clearGallery), load = useStore(s => s.loadGallery);
  const [locked, setLocked] = useState(false), [confirm, setConfirm] = useState(false), [downloading, setDownloading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!locked) scroller.current?.scrollTo({ top: 0 }); }, [images.length, locked]);
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    const sync = () => document.documentElement.style.setProperty("--nai-toast-bottom", `${element.getBoundingClientRect().height + 6}px`);
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    sync();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--nai-toast-bottom");
    };
  }, []);
  const downloadAll = async () => {
    setDownloading(true);
    try {
      const JSZip = (await import("jszip")).default, zip = new JSZip();
      for (const image of images) zip.file(image.filename, image.dataUrl.split(",")[1], { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "sakura-history.zip"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(String(e)); } finally { setDownloading(false); }
  };
  return <div className="flex h-full flex-col">
    <button onClick={() => setUI({ galleryOpen: false })} className="flex h-16 shrink-0 items-center justify-between border-b border-border-soft px-4 text-xs font-semibold" aria-label={t("Collapse gallery")}>{t("History")}<ChevronRight className="size-3" /></button>
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:thin]" data-testid="gallery-list">
      {status === "error" ? <Button size="sm" onClick={() => void load()}><RotateCcw />{t("Retry")}</Button> : images.length ? <div className="flex flex-col gap-2">
        {images.map(img => <button key={img.id ?? img.filename} aria-label={t("View image, seed {0}", img.seed)} aria-pressed={selected?.id === img.id} title={`${img.settings.prompt}\n${img.seed}`} onClick={() => {
          selectBatch(img.batchId); selectImage(img);
          if (window.matchMedia("(max-width: 1023px)").matches) setUI({ galleryOpen: false });
        }} className={cn("flex w-full shrink-0 justify-center overflow-hidden rounded border-2 bg-bg p-1", selected?.id === img.id ? "border-accent" : "border-transparent hover:border-border")}>
          <img src={img.dataUrl} alt="" loading="lazy" className="max-h-40 w-full object-contain" />
        </button>)}
      </div> : <p className="px-2 py-4 text-center text-xs leading-5 text-muted">{status === "loading" ? t("Loading…") : t("Your generations will appear here.")}</p>}
    </div>
    <div ref={footer} data-testid="history-footer" className="shrink-0 border-t border-border-soft">
    <div className="flex justify-center p-1">
      <IconButton size="sm" label={t("Lock history scrolling")} aria-pressed={locked} onClick={() => setLocked(!locked)}>{locked ? <Lock /> : <LockOpen />}</IconButton>
      <IconButton size="sm" label={t("Download all images")} disabled={!images.length || downloading} onClick={() => void downloadAll()}><Download /></IconButton>
      <IconButton size="sm" label={t("Delete selected image")} disabled={!selected} onClick={() => selected?.id && void remove(selected.id)}><Trash2 /></IconButton>
    </div>
    {images.length > 1 && <button className="block w-full pb-2 text-[10px] text-muted" onClick={() => setConfirm(true)}>{t("Clear all")}</button>}
    </div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title={t("Delete all images?")} description={t("This permanently removes all {0} images from local storage. It can't be undone.", images.length)}><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(false)}>{t("Cancel")}</Button><Button variant="destructive" onClick={() => { void clear(); setConfirm(false); }}>{t("Delete all")}</Button></div></Modal>
  </div>;
}
