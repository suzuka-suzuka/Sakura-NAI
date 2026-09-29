"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Dices, Lock, LockOpen } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  MODEL_OPTIONS,
  isV5Model, maxSamples,
  SAMPLER_OPTIONS,
  SIZE_TIERS,
  presetDims,
  tierAspectForSize,
  aspectsForTier,
  sizeSummary,
} from "@/lib/nai/models";
import { Field, Section } from "./field";
import { TagTextarea } from "./tag-textarea";
import { AspectLock, DimensionInput } from "./dimension-input";
import { Select } from "@/components/ui/select";
import { NumberInput } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { PresetSelect } from "./preset-select";
import { CharactersTab } from "./characters-tab";
import { QUALITY_PRESETS, NEGATIVE_PRESETS, qualityPreset, type QualityPreset, type NegativePreset } from "@/lib/nai/presets";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_SEED = 4294967295;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * With aspect lock on, the edited side's proportional change is applied to the other side and
 * snapped back onto the 64px grid NovelAI requires. Clamped to the same 64…2048 bounds as the
 * fields themselves, so dragging one side to an extreme can't push the other out of range.
 */
const scaleTo = (next: number, prev: number, other: number) =>
  Math.min(2048, Math.max(64, Math.round((other * (next / prev)) / 64) * 64));

export function BasicTab() {
  useLocale();
  const s = useStore((st) => st.settings);
  const patch = useStore((st) => st.patchSettings);
  const lastSeed = useStore((st) => st.selectedImage?.seed);
  const [tier, aspect] = tierAspectForSize(s.width, s.height);
  const isRandom = s.seed < 0;
  const [linked, setLinked] = useState(false);

  // Where "Custom" returns to. Tracks the last size that matched a real preset.
  const lastPreset = useRef({ w: s.width, h: s.height });
  useEffect(() => {
    if (tier !== null) lastPreset.current = { w: s.width, h: s.height };
  }, [tier, s.width, s.height]);

  const setPreset = (t: string, a: string) => {
    const p = presetDims(t, a) ?? presetDims(t, "portrait") ?? presetDims("normal", a);
    if (p) patch({ width: p.w, height: p.h });
  };

  return (
    <>
      <Section title={translateUI("Model")}>
        <Select value={s.model} onChange={(e) => patch({ model: e.target.value as typeof s.model })}>
          {MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {translateUI(m.label)}
            </option>
          ))}
        </Select>
      </Section>

      <Section title={translateUI("Prompt")}>
        <div className="rounded-[var(--radius-input)] border border-border bg-surface-2 focus-within:border-accent/60" data-testid="positive-prompt-editor">
          <TagTextarea
            id="prompt"
            className="min-h-[112px] rounded-b-none border-0 bg-transparent focus:shadow-none"
            aria-label={translateUI("Prompt")}
            value={s.prompt}
            onChange={(prompt) => patch({ prompt })}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2.5 pt-1" data-testid="positive-prompt-footer">
            {isV5Model(s.model) && <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-medium text-fg-2">
              <input type="checkbox" className="size-3.5 cursor-pointer accent-accent" checked={s.transparentBackground} onChange={e => patch({ transparentBackground: e.target.checked })} />
              {translateUI("Transparent background")}
            </label>}
            <div className="ml-auto">
              <PresetSelect label={translateUI("Quality preset")} prefix={translateUI("Quality tags")} value={qualityPreset(s)} options={QUALITY_PRESETS} onChange={value => patch({ qualityPreset: value as QualityPreset, qualityToggle: value !== "none" })} />
            </div>
          </div>
        </div>
      </Section>

      <Section title={translateUI("Undesired content")}>
        <div className="rounded-[var(--radius-input)] border border-border bg-surface-2 focus-within:border-accent/60" data-testid="negative-prompt-editor">
          <TagTextarea
            id="uc"
            aria-label={translateUI("Undesired content")}
            className="min-h-[96px] rounded-b-none border-0 bg-transparent focus:shadow-none"
            value={s.negativePrompt}
            onChange={(negativePrompt) => patch({ negativePrompt })}
          />
          <div className="flex justify-end px-2.5 pb-2.5 pt-1" data-testid="negative-prompt-footer">
            <PresetSelect label={translateUI("Undesired content preset")} prefix={translateUI("Negative tags")} value={String(s.ucPreset)} options={NEGATIVE_PRESETS} onChange={value => patch({ ucPreset: Number(value) as NegativePreset })} />
          </div>
        </div>
      </Section>

      <CharactersTab />

      <Section title={translateUI("Resolution")}>
        <div className="mb-3 flex flex-col gap-2">
          {/* Only the aspects this tier actually has — Wallpaper has no Square, and offering it
              made clicking Wallpaper silently rewrite your aspect. */}
          <Segmented
            className="w-full"
            aria-label={translateUI("Aspect ratio")}
            options={aspectsForTier(tier ?? "normal").map((a) => ({ value: a as string, label: cap(a) }))}
            value={aspect ?? ""}
            onValueChange={(a) => setPreset(tier ?? "normal", a)}
          />
          {/* A non-preset size used to leave BOTH rows with zero active segments, which reads as a
              rendering bug. "Custom" gives that state a name; re-clicking returns to the last preset. */}
          <Segmented
            className="w-full"
            aria-label={translateUI("Size")}
            options={[
              ...SIZE_TIERS.map((t) => ({ value: t as string, label: cap(t) })),
              ...(tier === null ? [{ value: "custom", label: translateUI("Custom") }] : []),
            ]}
            value={tier ?? "custom"}
            onValueChange={(t) => {
              if (t === "custom") {
                patch({ width: lastPreset.current.w, height: lastPreset.current.h });
                return;
              }
              setPreset(t, aspect ?? "portrait");
            }}
          />
        </div>
        <div className="flex items-end gap-2">
          <DimensionInput
            id="w"
            label={translateUI("Width")}
            min={64}
            max={2048}
            step={64}
            value={s.width}
            onCommit={(width) => patch(linked ? { width, height: scaleTo(width, s.width, s.height) } : { width })}
          />
          <AspectLock locked={linked} onToggle={() => setLinked((v) => !v)} />
          <DimensionInput
            id="h"
            label={translateUI("Height")}
            min={64}
            max={2048}
            step={64}
            value={s.height}
            onCommit={(height) => patch(linked ? { height, width: scaleTo(height, s.height, s.width) } : { height })}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {/* A live proportion swatch: the numbers say 832×1216, this says "tall". Reading a shape
              is faster than dividing two four-digit numbers. */}
          <span
            aria-hidden
            className="flex h-6 w-10 shrink-0 items-center justify-center rounded-[5px] border border-border-soft bg-surface-2"
          >
            <span
              className="rounded-[2px] bg-accent/70 transition-[width,height] duration-base ease-out"
              style={{
                width: `${Math.max(10, (s.width >= s.height ? 1 : s.width / s.height) * 20)}px`,
                height: `${Math.max(6, (s.height >= s.width ? 1 : s.height / s.width) * 16)}px`,
              }}
            />
          </span>
          <p className="truncate text-right font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-muted">
            {sizeSummary(s.width, s.height)}
          </p>
        </div>
      </Section>

      <Section title={translateUI("Sampling")}>
        <Field label={translateUI("Seed")}>
          <div className="flex gap-2">
            <NumberInput
              min={0}
              max={MAX_SEED}
              disabled={isRandom}
              value={isRandom ? "" : s.seed}
              placeholder={lastSeed !== undefined ? translateUI("random · last {0}", lastSeed) : translateUI("random")}
              onChange={(e) => patch({ seed: Number(e.target.value) })}
              className="flex-1"
            />
            {/* Fixed two-control row. Previously this went 2->3 children on toggle, resizing the
                input under the cursor, and the icons named the action rather than the state —
                so Dices *pinned* a seed and Lock *unlocked* it. */}
            <Button
              variant="outline"
              size="icon"
              aria-label={translateUI("Roll a new seed")}
              title={translateUI("Roll a new seed")}
              onClick={() => patch({ seed: Math.floor(Math.random() * MAX_SEED) })}
            >
              <Dices className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={isRandom ? translateUI("Seed is random — click to pin") : translateUI("Seed is pinned — click to randomize")}
              title={isRandom ? translateUI("Seed is random — click to pin") : translateUI("Seed is pinned — click to randomize")}
              className={cn(!isRandom && "border-accent text-accent")}
              onClick={() => patch({ seed: isRandom ? Math.floor(Math.random() * MAX_SEED) : -1 })}
            >
              {isRandom ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
            </Button>
          </div>
        </Field>
        <Field>
          <Slider label={translateUI("Batch size")} min={1} max={maxSamples(s.model, s.width, s.height)} value={s.nSamples} onValueChange={(v) => patch({ nSamples: v })} format={(v) => translateUI("{0} image{1}", v, v > 1 ? "s" : "")} />
        </Field>
        <Field hint={translateUI("More steps means finer detail and a slower run. 23–28 is typical.")}>
          <Slider label={translateUI("Steps")} showRange min={1} max={50} value={s.steps} onValueChange={(v) => patch({ steps: v })} />
        </Field>
        <Field label={translateUI("Sampler")} htmlFor="sampler">
          <Select id="sampler" value={s.sampler} onChange={(e) => patch({ sampler: e.target.value as typeof s.sampler })}>
            {SAMPLER_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {translateUI(m.label)}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

    </>
  );
}
