"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, X, Palette } from "lucide-react";
import { useStore } from "@/lib/store";
import { parseReference } from "@/lib/nai/client";
import { IMAGE_FILE_ACCEPT } from "@/lib/image-picker";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Slider } from "@/components/ui/slider";
import { Select } from "@/components/ui/select";
import { isV4Model, isV5Model } from "@/lib/nai/models";
import { Model } from "@/lib/nai/protocol";
import { isVibeFile, VIBE_FILE_ACCEPT, vibeEncoding, MAX_VIBES } from "@/lib/nai/vibes";
import { prepareStyleImport } from "@/lib/style-import";
import type { ReferenceImage } from "@/lib/nai/types";

/** Multi-image uploader for vibe transfer / director reference, with per-image sliders. */
export function ReferenceUploader({
  field,
  emptyLabel,
}: {
  field: "vibe" | "directorReference";
  emptyLabel: string;
}) {
  useLocale();
  const refs = useStore((s) => s.settings[field]);
  const add = useStore((s) => s.addReference);
  const update = useStore((s) => s.updateReference);
  const remove = useStore((s) => s.removeReference);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const model = useStore(s => s.settings.model), patch = useStore(s => s.patchSettings);
  const normalizeReferenceStrength = useStore(s => s.settings.normalizeReferenceStrength);
  const blocked = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing || !!s.pendingPayment);
  const hasCharacterReferences = useStore(s => s.settings.directorReference.length > 0);
  const vibe = field === "vibe", v5 = isV5Model(model);

  const onFiles = async (files: FileList | null) => {
    if (!files || blocked) return;
    const chosen = Array.from(files);
    if (vibe && chosen.some(file => isVibeFile(file.name))) {
      await prepareStyleImport(chosen);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setReading(true);
    for (const file of chosen) {
      try {
        const { base64, preview } = await parseReference(file);
        const latest = useStore.getState();
        if (latest.isGenerating || latest.isPreparing || latest.isDirectorProcessing || latest.pendingPayment) break;
        if (latest.settings[field].length >= MAX_VIBES) throw new Error("Use between 1 and 16 Vibe references.");
        if (vibe && latest.settings.imageSource?.mode === "infill") throw new Error("Vibe Transfer is unavailable during inpainting. Switch to text-to-image or Image2Image first.");
        if (vibe && isV5Model(useStore.getState().settings.model)) patch({ model: Model.V4_5 });
        if (vibe) patch({ directorReference: [] });
        add(field, { base64, preview, name: file.name, strength: 0.6, informationExtracted: 1.0 });
      } catch (e) {
        toast.error(translateUI(e instanceof Error ? e.message : "Couldn't read {0}", file.name));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
    setReading(false);
  };

  return (
    <div>
      {vibe && isV4Model(model) && <label
        className="my-3 flex cursor-pointer items-start gap-2 text-[13px] font-semibold text-fg-2"
        title={translateUI("Automatically normalize Vibe reference strengths to avoid excessive combined influence. Individual strength values stay unchanged.")}
      >
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent"
          checked={normalizeReferenceStrength ?? false}
          onChange={event => patch({ normalizeReferenceStrength: event.target.checked })} />
        <span>{translateUI("Normalize Reference Strength Values")}</span>
      </label>}
      <input
        ref={inputRef}
        type="file"
        accept={vibe ? `${IMAGE_FILE_ACCEPT},${VIBE_FILE_ACCEPT}` : IMAGE_FILE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button variant="outline" size="sm" disabled={blocked || reading} className="w-full" onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" /> {translateUI(vibe && v5 ? "Add a Vibe / image (switch to V4.5)" : vibe ? "Add Vibe file / reference image" : "Add reference image")}</Button>
      {vibe && hasCharacterReferences && <p className="mt-2 text-xs text-muted">{translateUI("Applying Vibes replaces the current character references.")}</p>}

      {refs.length === 0 ? (
        <p className="mt-2 text-center text-[12px] text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {refs.map((r, i) => (
            <div key={i} className="flex gap-3 rounded-[var(--radius-card)] border border-border-soft bg-surface-2 p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.preview ? <img
                src={r.preview}
                alt="reference"
                className="size-16 shrink-0 rounded-[8px] object-cover"
              /> : <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-bg"><Palette className="size-7 text-accent" /></span>}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input aria-label={translateUI("Reference name")} value={r.name ?? ""} placeholder={`Vibe ${i + 1}`} maxLength={200} disabled={blocked} onChange={event => update(field, i, { name: event.target.value })} className="min-w-0 rounded bg-transparent text-xs outline-none focus:ring-1 focus:ring-accent" />
                <fieldset disabled={blocked} className="space-y-2">
                {!vibe && <label className="block space-y-1 text-xs text-muted">{translateUI("Reference type")}
                  <Select className="h-8 py-0 pl-2 pr-8 text-xs" aria-label={translateUI("Reference type")} value={r.referenceType ?? "character&style"}
                    onChange={event => update(field, i, { referenceType: event.target.value as ReferenceImage["referenceType"] })}>
                    <option value="character&style">{translateUI("Character & style reference")}</option>
                    <option value="character">{translateUI("Character reference")}</option>
                    <option value="style">{translateUI("Style reference")}</option>
                  </Select>
                </label>}
                <Slider label={translateUI("Strength")} min={0} max={1} step={0.01} value={r.strength}
                  onValueChange={strength => update(field, i, { strength })} format={value => value.toFixed(2)} />
                {vibe && !r.base64 ? <label className="block text-xs text-muted">{translateUI("Information extracted (saved encodings)")}
                  <Select aria-label={translateUI("Information extracted (saved encodings)")} value={r.informationExtracted} onChange={event => update(field, i, { informationExtracted: Number(event.target.value) })}>
                    {[...new Set((r.encodings ?? []).map(encoding => encoding.informationExtracted))].sort((a,b) => a-b).map(value => <option key={value} value={value}>{value.toFixed(2)}</option>)}
                  </Select>
                </label> : <Slider
                  label={translateUI("Info extracted")}
                  min={0}
                  max={1}
                  step={0.01}
                  value={r.informationExtracted}
                  onValueChange={(v) => update(field, i, { informationExtracted: v })}
                  format={(v) => v.toFixed(2)}
                />}
                </fieldset>
                {vibe && <span className="text-[10px] text-muted">{translateUI(vibeEncoding(r, model) ? "Encoded · no encoding charge" : !r.base64 ? "Encoding is for another model. Apply this Vibe from the library to switch models." : "Encoding may cost 2 Anlas when using a new model or extraction value.")}</span>}
              </div>
              <IconButton
                label={translateUI("Remove reference")}
                disabled={blocked}
                size="sm"
                variant="subtle"
                onClick={() => remove(field, i)}
                className="self-start hover:text-danger"
              >
                <X />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
