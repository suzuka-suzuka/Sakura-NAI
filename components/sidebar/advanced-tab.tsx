"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { NOISE_OPTIONS, isV5Model, isV4Model } from "@/lib/nai/models";
import { Field, Section } from "./field";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SwitchRow } from "@/components/ui/switch";
import { ReferenceUploader } from "./reference-uploader";

export function AdvancedTab() {
  useLocale();
  const s = useStore((st) => st.settings);
  const patch = useStore((st) => st.patchSettings);

  const preferences = useStore(st => st.preferences);
  const patchPreferences = useStore(st => st.patchPreferences);
  const v5 = isV5Model(s.model);
  const modern = v5 || isV4Model(s.model);

  return (
    <>
      <Section title={translateUI("Generation and preview")}>
        <Field><SwitchRow label={translateUI("Streaming preview")} hint={translateUI("When off, keep the previous image until the new batch is complete.")} checked={preferences.streamPreview} onCheckedChange={streamPreview => patchPreferences({ streamPreview })} /></Field>
        <Field><SwitchRow label={translateUI("Confirm paid generation")} hint={translateUI("Ask once when switching from 0 points to a paid generation.")} checked={preferences.confirmPaid} onCheckedChange={confirmPaid => patchPreferences({ confirmPaid })} /></Field>
      </Section>
      <Section title={translateUI("Guidance")}>
        <Field hint={translateUI("Higher follows the prompt more literally and leaves less room for invention. 4–7 is typical.")}>
          <Slider label={translateUI("Prompt guidance (CFG)")} showRange min={1} max={10} step={0.1} value={s.scale} onValueChange={(v) => patch({ scale: v })} format={(v) => v.toFixed(1)} />
        </Field>
        <Field hint={translateUI("Softens over-saturation at high guidance. Leave at 0 unless colours look burnt.")}>
          <Slider label={translateUI("Guidance rescale")} showRange min={0} max={1} step={0.01} value={s.cfgRescale} onValueChange={(v) => patch({ cfgRescale: v })} format={(v) => v.toFixed(2)} />
        </Field>
        <Field label={translateUI("Noise schedule")} htmlFor="noise">
          <Select id="noise" disabled={v5} value={v5 ? "karras" : s.noiseSchedule} onChange={(e) => patch({ noiseSchedule: e.target.value as typeof s.noiseSchedule })}>
            {NOISE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {translateUI(m.label)}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {v5 && <Section title={translateUI("V5 options")}>
        <Field><SwitchRow label={translateUI("Auto text")} hint={translateUI('Collect quoted text into a Text: block. A manual Text: block takes precedence.')} checked={s.autoText} onCheckedChange={v => patch({ autoText: v })} /></Field>
      </Section>}
      <Section title={translateUI("Options")} description={translateUI("Specialized sampling controls")} collapsible defaultOpen={false}>
        <Field>
          <SwitchRow
            label={translateUI("Dynamic thresholding")}
            hint={translateUI("Rescues detail lost to very high guidance. Usually off.")}
            disabled={modern}
            checked={!modern && s.dynamicThresholding}
            onCheckedChange={(v) => patch({ dynamicThresholding: v })}
          />
        </Field>
        <Field>
          <SwitchRow
            label={translateUI("Auto SMEA")}
            hint={translateUI("Improves coherence at large resolutions. Ignored on small sizes.")}
            disabled={modern}
            checked={!modern && s.autoSmea}
            onCheckedChange={(v) => patch({ autoSmea: v })}
          />
        </Field>
      </Section>

      {v5 ? <p className="text-xs text-muted">{translateUI("V5 does not support Vibe Transfer or character reference images yet. Saved references are kept for other models.")}</p> : <>
      <Section title={translateUI("Vibe transfer")} description={translateUI("{0} reference{1}", s.vibe.length, s.vibe.length === 1 ? "" : "s")} collapsible defaultOpen={s.vibe.length > 0}>
        <ReferenceUploader field="vibe" emptyLabel={translateUI("Transfer the vibe of reference images.")} />
      </Section>

      {s.model.includes("4-5") && <Section
        title={translateUI("Director / character reference")}
        description={translateUI("{0} reference{1}", s.directorReference.length, s.directorReference.length === 1 ? "" : "s")}
        collapsible
        defaultOpen={s.directorReference.length > 0}
      >
        {s.vibe.length > 0 && <p className="mb-2 text-xs text-muted">{translateUI("Character reference takes priority over Vibe Transfer.")}</p>}
        <ReferenceUploader field="directorReference" emptyLabel={translateUI("Guide character features from a reference.")} />
      </Section>}
      </>}
    </>
  );
}
