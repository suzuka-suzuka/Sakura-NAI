"use client";

import { useId } from "react";
import { Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { activeGenerationSettings, enhanceFactors, imageToolOutputSize, resolveEnhanceFactor } from "@/lib/nai/image-tools";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { GenerationCost, useGenerationCost } from "@/components/generation-cost";
import { NumericSlider } from "@/components/sidebar/official-composer";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

/** A workspace panel: the sidebar stays available while enhancement options are open. */
export function EnhancePanel() {
  useLocale();
  const id = useId();
  const enhancement = useStore(s => s.enhancement), settings = useStore(s => s.settings);
  const patch = useStore(s => s.patchEnhancement), close = useStore(s => s.closeEnhancement);
  const generate = useStore(s => s.generate), busy = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing);
  const cost = useGenerationCost();
  if (!enhancement) return null;
  const factor = resolveEnhanceFactor(enhancement, settings.model);
  const effective = activeGenerationSettings(settings, enhancement);
  const output = imageToolOutputSize(effective);
  return <section aria-label={t("Enhance image")} className="absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[calc(100%_-_1.5rem)] max-w-2xl overflow-y-auto rounded border border-border bg-surface p-4 shadow-xl">
    <div className="mb-4 flex items-center gap-2">
      <Sparkles className="size-4" />
      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">{t("Enhance image")}</h2>
      <IconButton className="-mr-1 ml-auto" size="sm" label={t("Close enhance")} onClick={close}><X /></IconButton>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-4">
      <div className="space-y-2">
        <span className="text-[13px] font-semibold">{t("Upscale amount")}</span>
        <div className="flex gap-1 rounded border border-border-soft p-1" role="group" aria-label={t("Upscale amount")}>
          {enhanceFactors(enhancement.source, settings.model).map(f => <Button key={f} size="sm" variant={factor === f ? "default" : "ghost"} aria-pressed={factor === f} disabled={busy} onClick={() => patch({ factor: f })}>
            {f === "max" ? <>{t("Max")}<Sparkles className="size-3" /></> : `${f}×`}
          </Button>)}
        </div>
      </div>
      <div className="min-w-0 flex-[1_1_260px]">
        <div id={id}>
          {enhancement.advanced ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericSlider label={t("Strength")} min={0.01} max={0.99} step={0.01} value={enhancement.strength} onChange={strength => patch({ strength })} />
            <NumericSlider label={t("Noise")} min={0} max={0.99} step={0.01} value={enhancement.noise} onChange={noise => patch({ noise })} />
          </div> : <NumericSlider label={t("Magnitude")} min={1} max={5} value={enhancement.magnitude} onChange={magnitude => patch({ magnitude })} />}
        </div>
        <button type="button" className="mt-3 text-sm text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={enhancement.advanced} aria-controls={id} onClick={() => patch({ advanced: !enhancement.advanced })}>
          {t(enhancement.advanced ? "Hide Advanced" : "Show Advanced")}
        </button>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>{output.width} × {output.height} · {effective.steps} {t("Steps")} · 1 {t("Images")}</span>
      <GenerationCost />
    </div>
    <Button className="mt-3 w-full lg:hidden" disabled={busy || !cost.valid} onClick={() => void generate()}>{t("Enhance")} · <GenerationCost /></Button>
  </section>;
}
