"use client";
/* eslint-disable @next/next/no-img-element -- Reference previews are embedded browser-local raster images. */

import { useRef, useState } from "react";
import { Download, FileImage, FolderOpen, Palette, Plus, Save, Trash2, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { createStylePreset, applyStylePreset, exportStylePresets, type StylePreset } from "@/lib/style-presets";
import { downloadStyleFile, prepareStyleImport, STYLE_FILE_ACCEPT } from "@/lib/style-import";
import { exportVibes, compatibleVibeModel } from "@/lib/nai/vibes";
import { isV5Model, modelLabel } from "@/lib/nai/models";
import { pickRecipeFile } from "@/lib/recipe-import";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { Modal } from "./ui/modal";
import { Select } from "./ui/select";
import { ReferenceUploader } from "./sidebar/reference-uploader";

const kindLabel = (kind: StylePreset["kind"]) => t(kind === "vibe" ? "Vibe setup" : kind === "settings" ? "Generation settings" : "Style / prompt tags");
const fieldClass = "w-full rounded-lg border border-border-soft bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
function report(error: unknown) { toast.error(t(error instanceof Error && error.name !== "ZodError" ? error.message : "This preset contains invalid or unsupported values.")); }

export function StyleLibraryModal() {
  useLocale();
  const open = useStore(s => s.showStyleLibrary);
  const setUI = useStore(s => s.setUI);
  return <Modal open={open} onClose={() => setUI({ showStyleLibrary: false, styleImport: null })} title={t("Styles and presets")} className="max-w-3xl">
    {open && <LibraryContent />}
  </Modal>;
}

function LibraryContent() {
  const settings = useStore(s => s.settings), setUI = useStore(s => s.setUI);
  const presets = useStore(s => s.stylePresets), status = useStore(s => s.styleStatus), pending = useStore(s => s.styleImport);
  const save = useStore(s => s.saveStylePresets), remove = useStore(s => s.deleteStylePreset);
  const running = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing || !!s.pendingPayment);
  const [saving, setSaving] = useState(false), [append, setAppend] = useState(true), [query, setQuery] = useState("");
  const [name, setName] = useState(""), [kind, setKind] = useState<StylePreset["kind"]>("prompt");
  const [prompt, setPrompt] = useState(settings.prompt), [negative, setNegative] = useState(settings.negativePrompt);
  const [editing, setEditing] = useState<string | null>(null), [renamed, setRenamed] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const disabled = running || saving;
  const writable = !disabled && status === "ready";
  const apply = (preset: StylePreset) => {
    try {
      const state = useStore.getState();
      state.restoreSettings(applyStylePreset(state.settings, preset, append), { message: t("Applied preset: {0}", preset.name) });
      state.closeEnhancement();
      setUI({ showStyleLibrary: false, styleImport: null, settingsCollapsed: false, activeTab: "basic", showPositions: false });
    } catch (error) { report(error); }
  };
  const store = async (items: StylePreset[], clearPending = false) => {
    setSaving(true);
    try { await save(items); if (clearPending) setUI({ styleImport: null }); toast.success(t("Saved {0} preset(s)", items.length)); return true; }
    catch (error) { report(error); return false; }
    finally { setSaving(false); }
  };
  const applyLabel = (preset: StylePreset) => {
    if (preset.kind !== "vibe") return t("Apply");
    try {
      const model = compatibleVibeModel([...(append ? settings.vibe : []), ...preset.vibes], settings.model);
      return model === settings.model ? t("Apply Vibes") : t("Apply and switch to {0}", modelLabel(model, true));
    } catch { return t("Apply Vibes"); }
  };
  const combined = pending?.presets.every(preset => preset.kind === "vibe") ? {
    id: "import", name: pending.presets.map(preset => preset.name).join(", "), kind: "vibe" as const,
    createdAt: new Date().toISOString(), vibes: pending.presets.flatMap(preset => preset.kind === "vibe" ? preset.vibes : []),
  } : pending?.presets.length === 1 ? pending.presets[0] : null;
  const visible = presets.filter(preset => preset.name.toLowerCase().includes(query.toLowerCase())).reverse();

  return <div className="space-y-5">
    <div className="rounded-xl border border-accent/25 bg-accent/5 p-3 sm:p-4">
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled || status === "loading"} onClick={() => input.current?.click()}><FolderOpen className="size-4" />{t("Import style / preset")}</Button>
        <Button variant="outline" disabled={disabled} onClick={() => { setUI({ showStyleLibrary: false, styleImport: null }); pickRecipeFile(); }}><FileImage className="size-4" />{t("Import from image")}</Button>
      </div>
      <input ref={input} type="file" multiple accept={STYLE_FILE_ACCEPT} className="hidden" aria-label={t("Choose style or preset files")} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (files.length) void prepareStyleImport(files);
      }} />
      <p className="mt-2 text-xs leading-relaxed text-muted">{t("Vibe files and bundles, Sakura preset JSON, or plain text artist / prompt tags.")}</p>
    </div>
    {status === "error" && <p role="alert" className="text-sm text-danger">{t("Local storage is unavailable. You can apply imports, but presets cannot be saved in this browser.")}</p>}
    <fieldset disabled={disabled} className="flex flex-wrap gap-4 text-sm">
      <legend className="sr-only">{t("How to apply")}</legend>
      <label className="flex items-center gap-2"><input type="radio" name="style-mode" checked={append} onChange={() => setAppend(true)} className="accent-accent" />{t("Append tags / Vibes")}</label>
      <label className="flex items-center gap-2"><input type="radio" name="style-mode" checked={!append} onChange={() => setAppend(false)} className="accent-accent" />{t("Replace tags / Vibes")}</label>
    </fieldset>
    {settings.directorReference.length > 0 && <p className="text-xs text-muted">{t("Applying Vibes replaces the current character references.")}</p>}
    {pending && <section className="space-y-3 rounded-xl border border-accent/40 p-3 sm:p-4" aria-label={t("Import preview")}>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("Import preview")} · {pending.presets.length}</h3><button type="button" className="text-xs text-muted hover:text-fg" disabled={disabled} onClick={() => setUI({ styleImport: null })}>{t("Cancel")}</button></div>
      <div className="max-h-52 space-y-2 overflow-y-auto">
        {pending.presets.map(preset => <div key={preset.id} className="rounded-lg bg-surface-2 p-3"><p className="break-words text-sm font-medium">{preset.name}</p><PresetPreview preset={preset} /></div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {combined && <Button disabled={disabled} onClick={() => apply(combined)}>{applyLabel(combined)}</Button>}
        <Button variant="outline" disabled={!writable} onClick={() => void store(pending.presets, true)}><Save className="size-4" />{t("Save to preset library")}</Button>
      </div>
      {combined?.kind === "settings" && <p className="text-xs text-muted">{t("Generation presets replace prompts, characters, sampling and seed; image inputs and references are cleared.")}</p>}
    </section>}
    <details className="rounded-xl border border-border-soft p-3" open={settings.vibe.length > 0 || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">{t("Current Vibes")} · {settings.vibe.length}</summary>
      <div className="mt-3 space-y-3">
        {isV5Model(settings.model) && <p className="text-xs leading-relaxed text-muted">{t("V5 does not support Vibe Transfer. Import a Vibe to choose a compatible model, or switch to V4.5 to add reference images.")}</p>}
        {isV5Model(settings.model) && settings.vibe.length > 0 && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => {
          try { useStore.getState().restoreSettings(applyStylePreset(settings, createStylePreset(t("Current Vibes"), "vibe", settings), false), { message: t("Applied preset: {0}", t("Current Vibes")) }); }
          catch (error) { report(error); }
        }}>{t("Switch to a compatible model and use these Vibes")}</Button>}
        <ReferenceUploader field="vibe" emptyLabel={t("Import a Vibe file or add a reference image.")} />
        {settings.vibe.length > 0 && <Button size="sm" variant="outline" disabled={disabled} onClick={() => { void (async () => {
          try { const exported = await exportVibes(settings.vibe, settings.model); downloadStyleFile(exported.text, `sakura-vibes${exported.extension}`); }
          catch (error) { report(error); }
        })(); }}><Download className="size-4" />{t("Export Vibes")}</Button>}
      </div>
    </details>
    <section className="rounded-xl border border-border-soft p-3 sm:p-4">
      <h3 className="mb-3 text-sm font-semibold">{t("Save a preset")}</h3>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input aria-label={t("Preset name")} placeholder={t("Preset name")} maxLength={200} value={name} onChange={event => setName(event.target.value)} className={fieldClass} />
        <Select aria-label={t("Preset type")} value={kind} onChange={event => setKind(event.target.value as StylePreset["kind"])} className="sm:w-48">
          {(["prompt", "settings", "vibe"] as const).map(value => <option key={value} value={value}>{kindLabel(value)}</option>)}
        </Select>
      </div>
      {kind === "prompt" && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted"><span>{t("Prompt / artist tags")}</span><textarea aria-label={t("Prompt / artist tags")} rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} className={fieldClass} /></label>
        <label className="space-y-1 text-xs text-muted"><span>{t("Undesired content")}</span><textarea aria-label={t("Preset negative prompt")} rows={3} value={negative} onChange={event => setNegative(event.target.value)} className={fieldClass} /></label>
      </div>}
      {kind === "settings" && <p className="mt-2 text-xs text-muted">{t("Saves the current prompts, characters, model, sampling and seed. Image inputs and references are not included.")}</p>}
      <Button className="mt-3" size="sm" variant="secondary" disabled={!writable || !name.trim() || kind === "vibe" && !settings.vibe.length} onClick={() => {
        try { const preset = createStylePreset(name, kind, kind === "prompt" ? { ...settings, prompt, negativePrompt: negative } : settings); void store([preset]).then(saved => { if (saved) setName(""); }); }
        catch (error) { report(error); }
      }}><Plus className="size-4" />{t("Save preset")}</Button>
    </section>
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("Preset library")} · {presets.length}</h3><Button size="sm" variant="ghost" disabled={!presets.length || disabled} onClick={() => { try { downloadStyleFile(exportStylePresets(presets), "sakura-presets.json"); } catch (error) { report(error); } }}><Download className="size-4" />{t("Export all")}</Button></div>
      {presets.length > 4 && <input type="search" aria-label={t("Search presets")} placeholder={t("Search presets")} value={query} onChange={event => setQuery(event.target.value)} className={fieldClass} />}
      {!visible.length && <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">{t(status === "loading" ? "Loading presets…" : "Save artist tags, prompts or a Vibe setup here for next time.")}</p>}
      {visible.map(preset => <article key={preset.id} className="rounded-xl border border-border-soft p-3">
        <div className="flex items-start justify-between gap-2">
          {editing === preset.id ? <div className="flex min-w-0 flex-1 gap-2"><input autoFocus aria-label={t("Rename preset")} value={renamed} maxLength={200} onChange={event => setRenamed(event.target.value)} className={fieldClass} /><IconButton label={t("Save name")} disabled={!writable || !renamed.trim()} onClick={() => void store([{ ...preset, name: renamed.trim() }]).then(saved => { if (saved) setEditing(null); })}><Check /></IconButton></div> : <p className="min-w-0 break-words text-sm font-semibold">{preset.name}</p>}
          <div className="flex shrink-0">
            <IconButton size="sm" disabled={disabled} label={t("Rename preset")} onClick={() => { setEditing(preset.id); setRenamed(preset.name); }}><Pencil /></IconButton>
            <IconButton size="sm" disabled={disabled} label={t("Export preset")} onClick={() => downloadStyleFile(exportStylePresets([preset]), `${preset.name}.json`)}><Download /></IconButton>
            <IconButton size="sm" disabled={!writable} label={t("Delete preset")} onClick={() => { void remove(preset.id).then(() => toast.success(t("Preset deleted"), { action: { label: t("Undo"), onClick: () => void store([preset]) } })).catch(report); }}><Trash2 /></IconButton>
          </div>
        </div>
        <PresetPreview preset={preset} />
        <Button className="mt-3" size="sm" variant="secondary" disabled={disabled} onClick={() => apply(preset)}>{applyLabel(preset)}</Button>
      </article>)}
      <p className="text-xs leading-relaxed text-muted">{t("Saved in this browser. Export presets to back them up or use them on another device.")}</p>
    </section>
  </div>;
}

function PresetPreview({ preset }: { preset: StylePreset }) {
  return <div className="mt-1 space-y-2">
    <p className="text-xs text-muted">{kindLabel(preset.kind)}{preset.kind === "vibe" ? ` · ${preset.vibes.length}` : preset.kind === "settings" ? ` · ${modelLabel(preset.settings.model, true)} · ${preset.settings.width}×${preset.settings.height}` : ""}</p>
    {preset.kind === "vibe" ? <div className="flex flex-wrap gap-2">{preset.vibes.map((ref, i) => <div key={i} className="flex items-center gap-2 rounded-md bg-bg p-1.5 text-xs">
      {ref.preview ? <img src={ref.preview} alt={ref.name ?? `Vibe ${i + 1}`} className="size-9 rounded object-cover" /> : <Palette className="size-7 text-accent" />}
      <span className="max-w-36 truncate">{ref.name ?? `Vibe ${i + 1}`}<span className="block text-muted">{t("Strength")} {ref.strength.toFixed(2)}</span></span>
    </div>)}</div> : <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-2">{preset.settings.prompt || t("Empty prompt")}</p>}
  </div>;
}
