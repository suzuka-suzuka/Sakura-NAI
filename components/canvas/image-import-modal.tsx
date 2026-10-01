"use client";

import { FileSliders, ImagePlus, Palette, UserRound } from "lucide-react";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { applyImageImport, type ImageImportPurpose } from "@/lib/recipe-import";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export function ImageImportModal() {
  useLocale();
  const image = useStore(s => s.imageImport);
  const setUI = useStore(s => s.setUI);
  const busy = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing || !!s.pendingPayment);
  const close = () => setUI({ imageImport: null });
  const choices: { purpose: ImageImportPurpose; title: string; icon: typeof Palette; disabled?: boolean }[] = [
    { purpose: "recipe", title: t("Import image parameters"),
      icon: FileSliders, disabled: !image?.recipe },
    { purpose: "img2img", title: t("Use as Image2Image base"), icon: ImagePlus },
    { purpose: "vibe", title: t("Use for Vibe Transfer"), icon: Palette },
    { purpose: "directorReference", title: t("Use as character reference"), icon: UserRound },
  ];

  return <Modal open={!!image} onClose={close} title={t("How would you like to use this image?")} className="max-w-xl">
    {image && <>
      <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-border-soft bg-surface-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.preview} alt={image.filename} className="size-20 shrink-0 rounded-lg object-contain" />
        <div className="min-w-0 text-sm">
          <p className="break-all font-semibold text-fg">{image.filename}</p>
          <p className="mt-1 text-xs text-muted">{image.width} × {image.height}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map(({ purpose, title, icon: Icon, disabled }) => <button
          key={purpose} type="button" disabled={busy || disabled}
          onClick={() => applyImageImport(purpose)}
          className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border-soft bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="text-sm font-semibold text-fg">{title}</span>
        </button>)}
      </div>
      <Button variant="ghost" className="mt-4 w-full" onClick={close}>{t("Cancel")}</Button>
    </>}
  </Modal>;
}
