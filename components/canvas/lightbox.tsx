"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/store";
import { useImageViewport } from "@/lib/use-image-viewport";
import { downloadDataUrl } from "@/lib/image-actions";
import { useFocusTrap, useDelayedUnmount } from "@/lib/use-overlay";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function Lightbox() {
  useLocale();
  const batch = useStore((s) => s.selectedBatch);
  const focusedIndex = useStore((s) => s.focusedIndex);
  const setUI = useStore((s) => s.setUI);
  const restoreSettings = useStore((s) => s.restoreSettings);
  const selectImage = useStore((s) => s.selectImage);
  const current = batch?.[focusedIndex ?? 0];
  const { container: viewportContainer, zoom: viewportZoom, fit: viewportFit, panning: viewportPanning, startPan: viewportStartPan, movePan: viewportMovePan, endPan: viewportEndPan, changeZoom: viewportChangeZoom, reset: viewportReset, style: viewportStyle } = useImageViewport(current?.settings.width ?? 1, current?.settings.height ?? 1);
  const suppressClick = useRef(false), pointerStart = useRef<{x:number;y:number}|null>(null);

  const open = focusedIndex !== null && !!batch && focusedIndex < batch.length;
  const mounted = useDelayedUnmount(open, 160);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  const close = () => {
    viewportReset();
    setUI({ focusedIndex: null });
  };
  const nav = (d: number) => {
    if (!batch || focusedIndex === null) return;
    viewportReset();
    const nextIndex = Math.min(batch.length - 1, Math.max(0, focusedIndex + d));
    setUI({ focusedIndex: nextIndex });
    if (nextIndex !== focusedIndex) selectImage(batch[nextIndex]);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") nav(-1);
      if (e.key === "ArrowRight") nav(1);
      // Zoom was pointer-only — the two magnifier buttons were the sole way to reach it.
      if (e.key === "+" || e.key === "=") viewportChangeZoom(1.25, undefined, true);
      if (e.key === "-") viewportChangeZoom(0.8, undefined, true);
      if (e.key === "0") viewportReset();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusedIndex, batch]);

  useEffect(() => { viewportReset(); }, [focusedIndex, current?.dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted || typeof document === "undefined" || !batch) return null;
  const idx = Math.min(focusedIndex ?? 0, batch.length - 1);
  const img = batch[idx];
  if (!img) return null;

  return createPortal(
    <div
      ref={trapRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={translateUI("Image {0} of {1}, seed {2}", idx + 1, batch.length, img.seed)}
      onClick={(event) => {
        if (event.target instanceof Element && !event.target.closest("img, button, [data-lightbox-controls]") && !suppressClick.current) close();
        suppressClick.current = false;
      }}
      className={cn(
        // Fade the chrome without changing the viewport's pixel coordinates.
        "fixed inset-0 z-50 flex flex-col bg-black/90 outline-none transition-opacity",
        open ? "opacity-100 duration-base ease-out" : "opacity-0 duration-fast ease-in",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3 text-white">
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-white/70">
          {idx + 1} / {batch.length} {translateUI(" · seed ")}{img.seed}
        </span>
        <div data-lightbox-controls className="flex max-w-full flex-wrap items-center gap-1">
          <IconButton variant="lightbox" label={translateUI("Zoom out")} disabled={viewportZoom <= 0.1} onClick={() => viewportChangeZoom(viewportZoom / 1.25)}>
            <ZoomOut />
          </IconButton>
          <IconButton variant="lightbox" label={translateUI("Zoom in")} disabled={viewportZoom >= 16} onClick={() => viewportChangeZoom(viewportZoom * 1.25)}>
            <ZoomIn />
          </IconButton>
          <button className="px-2 text-xs text-white/80" onClick={viewportReset}>{translateUI("Fit canvas")}</button>
          <button className="px-2 text-xs text-white/80" disabled={!viewportFit} onClick={()=>viewportChangeZoom(1/viewportFit)}>{translateUI("Actual size")}</button>
          <IconButton variant="lightbox" label={translateUI("Reuse settings")} onClick={() => restoreSettings(img.settings)}>
            <RotateCcw />
          </IconButton>
          <IconButton variant="lightbox" label={translateUI("Download")} onClick={() => downloadDataUrl(img.dataUrl, img.filename)}>
            <Download />
          </IconButton>
          <IconButton variant="lightbox" label={translateUI("Close")} onClick={close}>
            <X />
          </IconButton>
        </div>
      </div>

      <div ref={viewportContainer} className="relative min-h-0 flex-1 overflow-hidden touch-none"
        onPointerDown={e=>{if(e.button!==0&&e.button!==1)return;if(e.target instanceof Element&&e.target.closest("button"))return;pointerStart.current={x:e.clientX,y:e.clientY};suppressClick.current=e.target instanceof HTMLImageElement;viewportStartPan(e);}}
        onPointerMove={e=>{if(pointerStart.current&&Math.hypot(e.clientX-pointerStart.current.x,e.clientY-pointerStart.current.y)>3)suppressClick.current=true;viewportMovePan(e);}}
        onPointerUp={()=>{pointerStart.current=null;viewportEndPan();}} onPointerCancel={()=>{pointerStart.current=null;viewportEndPan();}}>
        {batch.length > 1 && (
          <IconButton variant="lightbox" size="lg" label={translateUI("Previous")} disabled={idx === 0} onClick={() => nav(-1)} className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
            <ChevronLeft />
          </IconButton>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- Browser-local gallery image. */}
        <img
          src={img.dataUrl}
          alt=""
          draggable={false}
          style={viewportStyle}
          className={`absolute select-none object-contain ${viewportPanning ? "cursor-grabbing" : "cursor-grab"}`}
        />
        {batch.length > 1 && (
          <IconButton variant="lightbox" size="lg" label={translateUI("Next")} disabled={idx === batch.length - 1} onClick={() => nav(1)} className="absolute right-3 top-1/2 z-20 -translate-y-1/2">
            <ChevronRight />
          </IconButton>
        )}
      </div>
    </div>,
    document.body,
  );
}
