"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Menu, X, ChevronDown, RotateCcw, KeyRound, Settings2, PanelLeftClose, Dices, Hash, Wand2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { SAMPLER_OPTIONS, NOISE_OPTIONS, isV5Model, isV4Model } from "@/lib/nai/models";
import { DEFAULT_SETTINGS } from "@/lib/nai/types";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { SwitchRow } from "@/components/ui/switch";
import { LanguageSwitch } from "@/components/language-switch";
import { ThemeControls } from "@/components/theme-controls";
import { BrandLogo } from "@/components/brand-logo";
import { GenerationCost } from "@/components/generation-cost";
import { GenerationWait } from "@/components/generation-wait";
import { OfficialComposer, NumericSlider } from "./official-composer";
import { CompactSampling } from "./compact-sampling";

function SamplingPanel() {
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings);
  const selected = useStore(st => st.selectedImage);
  const modern = isV5Model(s.model) || isV4Model(s.model);
  return <div className="space-y-4 px-3 pb-3">
    <NumericSlider label={t("Steps")} value={s.steps} min={1} max={50} onChange={steps => patch({ steps })} />
    <NumericSlider label={t("Prompt guidance (CFG)")} value={s.scale} min={1} max={10} step={0.1} onChange={scale => patch({ scale })} />
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-2 text-xs font-semibold"><span>{t("Seed")}</span><div className="flex items-center gap-1">
        <input aria-label={t("Seed")} type="number" min={-1} max={4294967295} value={s.seed < 0 ? "" : s.seed} onChange={e => patch({ seed: e.target.value === "" ? -1 : Math.min(4294967295, Math.max(0, Number(e.target.value))) })} className="h-9 w-full min-w-0 rounded bg-bg px-2 text-xs outline-none" />
        <IconButton size="sm" label={t("Random seed")} onClick={() => patch({ seed: -1 })}><Dices /></IconButton>
        <IconButton size="sm" label={t("Copy seed to settings")} disabled={!selected} onClick={() => selected && patch({ seed: selected.seed })}><Hash /></IconButton>
      </div></label>
      <label className="space-y-2 text-xs font-semibold"><span>{t("Sampler")}</span><Select aria-label={t("Sampler")} className="h-9 rounded px-2 text-xs" value={s.sampler} onChange={e => patch({ sampler: e.target.value as typeof s.sampler })}>{SAMPLER_OPTIONS.filter(o => !modern || o.value !== "ddim_v3").map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></label>
    </div>
    <details><summary className="cursor-pointer text-xs text-muted">{t("Advanced settings")}</summary><div className="mt-4 space-y-4">
      <NumericSlider label={t("Guidance rescale")} min={0} max={1} step={0.01} value={s.cfgRescale} onChange={cfgRescale => patch({ cfgRescale })} />
      {!isV5Model(s.model) && <label className="block text-xs">{t("Noise schedule")}<Select value={s.noiseSchedule} onChange={e => patch({ noiseSchedule: e.target.value as typeof s.noiseSchedule })}>{NOISE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></label>}
      {!modern && <><SwitchRow label={t("Dynamic thresholding")} checked={s.dynamicThresholding} onCheckedChange={dynamicThresholding => patch({ dynamicThresholding })} /><SwitchRow label={t("Auto SMEA")} checked={s.autoSmea} onCheckedChange={autoSmea => patch({ autoSmea })} /></>}
    </div></details>
  </div>;
}

export function SettingsSidebar() {
  useLocale();
  const s = useStore(st => st.settings), patch = useStore(st => st.patchSettings), setUI = useStore(st => st.setUI);
  const generate = useStore(st => st.generate), cancel = useStore(st => st.cancelGenerate);
  const isGenerating = useStore(st => st.isGenerating), isPreparing = useStore(st => st.isPreparing), cancellable = useStore(st => st.canCancelGeneration);
  const streaming = useStore(st => st.streamingBatch), account = useStore(st => st.account), client = useStore(st => st.client);
  const activeTab = useStore(st => st.activeTab), prefs = useStore(st => st.preferences), patchPrefs = useStore(st => st.patchPreferences);
  const enhancement = useStore(st => st.enhancement);
  const [menu, setMenu] = useState(false), [sampling, setSampling] = useState(false);
  const progress = streaming?.length ? Math.round(streaming.reduce((n, tile) => n + tile.progress, 0) / streaming.length * 100) : 0;
  return <div className="flex h-full flex-col">
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3">
      <span title="Sakura NAI"><BrandLogo variant="mark" className="size-9" /></span>
      <button className="rounded bg-surface-2 px-3 py-2 text-xs font-semibold" onClick={() => setUI({ showConnect: true })}><span className="text-muted">Anlas: </span>{account?.anlas ?? (client ? "—" : t("Connect"))}</button>
      <div className="flex gap-1">
        <IconButton className="lg:hidden" label={t("Collapse settings")} size="sm" onClick={() => setUI({ settingsCollapsed: true })}><PanelLeftClose /></IconButton>
        <IconButton label={t("Reset all settings")} onClick={() => {
          useStore.getState().resetSettings();
          setMenu(false);
          toast.success(t("All settings reset"), { id: "settings-reset" });
        }}><RotateCcw /></IconButton>
        <IconButton label={t("Menu")} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</IconButton>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
      {menu ? <div className="space-y-3 p-4">
        <h2 className="mb-5"><BrandLogo className="h-10 w-40" /></h2>
        <Button variant="secondary" className="w-full justify-start" onClick={() => setUI({ showConnect: true })}><KeyRound />{t("Connection settings")}</Button>
        <Button variant="secondary" className="w-full justify-start" onClick={() => setUI({ activeTab: "advanced" })}><Settings2 />{t("Settings")}</Button>
        <Button variant="secondary" className="w-full justify-start" onClick={() => setUI({ showDirector: true })}><Wand2 />{t("Director tools")}</Button>
        <div className="flex items-center justify-between border-t border-border-soft pt-4"><LanguageSwitch /><ThemeControls /></div>
      </div> : <OfficialComposer />}
    </div>
    <div className="shrink-0 border-t border-border-soft bg-surface p-3">
      <div className="mb-3 rounded border border-border-soft bg-surface-2/40">
        {sampling ? <>
          <div className="flex items-center justify-between px-3 py-2 text-xs text-muted"><span>{t("AI settings")}</span><div className="flex"><IconButton size="sm" label={t("Reset sampling settings")} onClick={() => patch({ steps: DEFAULT_SETTINGS.steps, scale: DEFAULT_SETTINGS.scale, seed: -1, sampler: DEFAULT_SETTINGS.sampler, cfgRescale: 0 })}><RotateCcw /></IconButton><IconButton size="sm" label={t("Collapse sampling")} onClick={() => setSampling(false)}><ChevronDown /></IconButton></div></div>
          <div className="max-h-[45dvh] overflow-y-auto"><SamplingPanel /></div>
        </> : <CompactSampling onExpand={() => setSampling(true)} />}
      </div>
      {isV5Model(s.model) && account?.tier === 3 && account.usage && <div className="mb-2 rounded border border-border-soft bg-bg p-2 text-[10px] text-accent">
        <span>{t("{0}% of Opus generations remaining", Math.round(account.usage.percent))}</span>
        <span className="mt-1 block h-1.5 rounded bg-surface-2"><span className="block h-full rounded bg-accent" style={{ width: `${account.usage.isNegative ? 0 : account.usage.percent}%` }} /></span>
      </div>}
      {isGenerating && !cancellable ? <GenerationWait /> : isGenerating ? <Button className="h-11 w-full" onClick={cancel}>{t("Stop")} · {progress}%</Button> :
        <Button className="h-11 w-full justify-between rounded text-sm font-bold" disabled={isPreparing} onClick={() => void generate()} aria-keyshortcuts="Meta+Enter Control+Enter"><span>{enhancement ? t("Enhance") : t("Generate {0} image(s)", s.nSamples)}</span><span className="rounded bg-bg px-2 py-1 text-accent"><GenerationCost /></span></Button>}
    </div>
    <Modal open={activeTab === "advanced"} onClose={() => setUI({ activeTab: "basic" })} title={t("Settings")} className="max-w-lg">
      <div className="space-y-5">
        <SwitchRow label={t("Streaming preview")} hint={t("When off, keep the previous image until the new batch is complete.")} checked={prefs.streamPreview} onCheckedChange={streamPreview => patchPrefs({ streamPreview })} />
        <SwitchRow label={t("Confirm paid generation")} hint={t("Ask once when switching from 0 points to a paid generation.")} checked={prefs.confirmPaid} onCheckedChange={confirmPaid => patchPrefs({ confirmPaid })} />
        <SwitchRow label={t("Auto text")} hint={t('Collect quoted text into a Text: block. A manual Text: block takes precedence.')} checked={s.autoText} onCheckedChange={autoText => patch({ autoText })} />
      </div>
    </Modal>
  </div>;
}
