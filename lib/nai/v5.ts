import { qualityText, negativeText, qualityPreset } from "./presets";
import { Sampler } from "./protocol";
import type { GenerationSettings } from "./types";
import { isV5Model, maxSamples } from "./models";
import { translateUI } from "../i18n";

// Protocol references and capability boundaries are documented in docs/NAI-V5.md.
// Keep V5 capabilities separate from legacy models.
/** Keep user text verbatim; insert managed tags before a manual Text: block. */
export function v5Prompt(s: GenerationSettings) {
  const input = s.promptMode === "furry" && !/^\s*fur dataset\b/i.test(s.prompt) ? `fur dataset, ${s.prompt}` : s.prompt;
  const textMatch = /(?:^|[\n,])\s*text\s*:/i.exec(input);
  const split = textMatch?.index ?? input.length;
  const visual = input.slice(0, split);
  const manual = input.slice(split);
  const quotes = s.autoText && !textMatch
    ? [input, ...s.characters.filter(c => c.enabled).map(c => c.prompt)]
      .flatMap(source => [...source.matchAll(/"([^"\n]+)"|「([^」\n]+)」/g)].map(m => (m[1] ?? m[2]).trim()).filter(Boolean))
    : [];
  const tags = qualityText(s).split(", ").filter(Boolean);
  if (s.transparentBackground) tags.push("transparent background");
  const existing = new Set(visual.split(",").map(tag => tag.trim().toLowerCase()));
  const added = tags.filter(tag => !existing.has(tag));
  const positive = visual + (added.length ? `${visual.trim() ? ", " : ""}${added.join(", ")}` : "");
  return positive + (manual && positive && !/^[,\n]/.test(manual) ? ", " : "") + manual + (quotes.length ? `, teXt: ${quotes.join("\n\n")}` : "");
}

export function buildV5Payload(s: GenerationSettings, seed: number) {
  if (!isV5Model(s.model)) throw new Error("Not a V5 model");
  if (![s.width, s.height].every(v => Number.isInteger(v) && v >= 64 && v <= 2048 && v % 64 === 0) || s.width * s.height > 3145728)
    throw new Error(translateUI("V5 dimensions must be multiples of 64, with at most 3,145,728 pixels."));
  if (!Number.isInteger(s.nSamples) || s.nSamples < 1 || s.nSamples > maxSamples(s.model, s.width, s.height))
    throw new Error(translateUI("This V5 resolution supports at most {0} images per batch.", maxSamples(s.model, s.width, s.height)));
  if (!Number.isInteger(s.steps) || s.steps < 1 || s.steps > 50 || !Number.isFinite(s.scale) || s.scale < 1 || s.scale > 10)
    throw new Error(translateUI("V5 needs 1–50 steps and guidance between 1 and 10."));
  const characters = s.characters.filter(c => c.enabled && c.prompt.trim());
  if (characters.length > 22) throw new Error(translateUI("V5 supports at most 22 enabled characters."));
  const centers = characters.map(c => {
    if (![c.center.x, c.center.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1))
      throw new Error(translateUI("Character coordinates must be between 0 and 1."));
    return [{ x: c.center.x, y: c.center.y }];
  });
  const input = v5Prompt(s);
  const negative = [negativeText(s), s.negativePrompt].filter(Boolean).join(", ");
  const useCoords = s.useCoords !== false && characters.length > 0;
  return {
    input,
    model: s.model,
    action: "generate",
    parameters: {
      params_version: 4,
      qualityPresetId: qualityPreset(s),
      ucPresetId: ({ 0: "heavy", 1: "light", 2: "human", 3: "none", 4: "furry" } as const)[s.ucPreset],
      ...(qualityPreset(s) === "light" ? { tag_hint_qt: 3 } : {}),
      ...(s.ucPreset === 0 ? { tag_hint_uc_preset: 2 } : {}),
      width: s.width, height: s.height,
      steps: s.steps, scale: s.scale, seed, n_samples: s.nSamples,
      sampler: s.sampler === Sampler.DDIM ? Sampler.EULER_ANC : s.sampler,
      noise_schedule: "karras", cfg_rescale: s.cfgRescale,
      dynamic_thresholding: false,
      legacy: false, legacy_uc: false, legacy_v3_extend: false,
      deliberate_euler_ancestral_bug: false, prefer_brownian: true,
      negative_prompt: negative,
      use_coords: useCoords,
      characterPrompts: characters.map(c => ({ prompt: c.prompt, uc: c.uc, center: c.center, enabled: true })),
      v4_prompt: {
        caption: { base_caption: input, char_captions: characters.map((c, i) => ({ char_caption: c.prompt, centers: centers[i] })) },
        use_coords: useCoords, use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negative, char_captions: characters.map((c, i) => ({ char_caption: c.uc, centers: centers[i] })) },
        legacy_uc: false,
      },
      straight_alpha: true,
      tag_hint_transparent_background: s.transparentBackground || /\b(?:transparent background|has alpha|alpha transparency)\b/i.test(s.prompt),
      image_format: "png",
      stream: "msgpack",
    },
  };
}
