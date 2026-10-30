import { z } from "zod";
import { DEFAULT_SETTINGS, type GenerationSettings, type ReferenceImage } from "./nai/types";
import { MODEL_OPTIONS, NOISE_OPTIONS, SAMPLER_OPTIONS, maxCharacters, isV4Model } from "./nai/models";
import { MAX_GENERATION_PIXELS, isGenerationDimension } from "./nai/dimensions";
import { compatibleVibeModel, encodedData, MAX_VIBES } from "./nai/vibes";

const modelSchema = z.enum(MODEL_OPTIONS.map(option => option.value));
const unit = z.number().min(0).max(1);
const image = z.string().max(64 * 1024 * 1024).refine(value => !value || /^[A-Za-z0-9+/]+={0,2}$/.test(value), "Invalid embedded image.");
const preview = z.string().max(64 * 1024 * 1024).refine(value => !value || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value), "Invalid embedded preview.");
const referenceSchema = z.object({
  referenceType: z.enum(["character", "style", "character&style"]).optional(),
  base64: image, preview, strength: unit, informationExtracted: unit, name: z.string().max(200).optional(), sourceModel: modelSchema.optional(),
  encodings: z.array(z.object({ model: modelSchema.refine(isV4Model), informationExtracted: unit, data: z.string().transform(encodedData), key: z.string().max(200).optional() })).max(256).optional(),
}).refine(ref => ref.base64 || ref.encodings?.length, "A Vibe needs an image or encoding.");
const characterSchema = z.object({
  prompt: z.string().max(100000), uc: z.string().max(100000), center: z.object({ x: unit, y: unit }), enabled: z.boolean(),
  name: z.string().max(200).optional(), collapsed: z.boolean().optional(),
});
const promptSchema = z.object({
  prompt: z.string().max(200000), negativePrompt: z.string().max(200000).default(""), characters: z.array(characterSchema).max(22).default([]),
  qualityToggle: z.boolean().default(false), qualityPreset: z.enum(["standard", "light", "none"]).default("none"),
  ucPreset: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3), autoText: z.boolean().default(false),
});
const settingsSchema = promptSchema.extend({
  model: modelSchema, promptMode: z.enum(["anime", "furry"]).optional(),
  width: z.number().refine(isGenerationDimension), height: z.number().refine(isGenerationDimension),
  steps: z.number().int().min(1).max(50), seed: z.number().int().min(-1).max(4294967295),
  sampler: z.enum(SAMPLER_OPTIONS.map(option => option.value)), noiseSchedule: z.enum(NOISE_OPTIONS.map(option => option.value)),
  scale: z.number().min(0).max(100), cfgRescale: unit, nSamples: z.number().int().min(1).max(8),
  dynamicThresholding: z.boolean(), autoSmea: z.boolean(), varietyPlus: z.boolean(), transparentBackground: z.boolean(), useCoords: z.boolean(),
  normalizeReferenceStrength: z.boolean().default(false),
}).refine(s => s.width * s.height <= MAX_GENERATION_PIXELS, "Image dimensions exceed the generation limit.");
const common = { name: z.string().trim().min(1).max(200), id: z.string().max(200), createdAt: z.string().max(100) };
const presetSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("prompt"), settings: promptSchema }),
  z.object({ ...common, kind: z.literal("settings"), settings: settingsSchema }),
  z.object({ ...common, kind: z.literal("vibe"), vibes: z.array(referenceSchema).min(1).max(MAX_VIBES), normalizeReferenceStrength: z.boolean().optional() }),
]);
export type StylePreset = z.infer<typeof presetSchema>;

export function createStylePreset(name: string, kind: StylePreset["kind"], settings: GenerationSettings): StylePreset {
  return presetSchema.parse({ id: crypto.randomUUID(), name, kind, createdAt: new Date().toISOString(),
    ...(kind === "vibe" ? { vibes: structuredClone(settings.vibe), normalizeReferenceStrength: settings.normalizeReferenceStrength } : { settings: { ...settings, qualityPreset: settings.qualityPreset ?? (settings.qualityToggle ? "standard" : "none") } }) });
}
export function parseStylePresets(text: string, filename: string): StylePreset[] {
  if (/\.txt$/i.test(filename)) {
    const prompt = text.replace(/^\uFEFF/, "").trim();
    if (!prompt) throw new Error("The prompt file is empty.");
    return [createStylePreset(filename.replace(/\.txt$/i, ""), "prompt", { ...DEFAULT_SETTINGS, prompt, qualityToggle: false, qualityPreset: "none", ucPreset: 3 })];
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("This preset file is not valid JSON."); }
  const envelope = value as { identifier?: string; version?: number; presets?: unknown[] } | null;
  if (envelope?.identifier !== "sakura-nai-presets" || envelope.version !== 1 || !Array.isArray(envelope.presets) || !envelope.presets.length || envelope.presets.length > 200) throw new Error("Use a Sakura preset JSON file or a plain text prompt file.");
  return envelope.presets.map(entry => ({ ...presetSchema.parse(entry), id: crypto.randomUUID() }));
}
export function exportStylePresets(presets: StylePreset[]): string {
  // Schema stripping ensures credentials, endpoints and arbitrary imported fields cannot be exported.
  return JSON.stringify({ identifier: "sakura-nai-presets", version: 1, presets: presets.map(preset => presetSchema.parse(preset)) }, null, 2);
}
export function validateStoredPresets(value: unknown): StylePreset[] {
  return z.array(presetSchema).max(200).parse(value);
}
export function validateStoredReferences(value: unknown): ReferenceImage[] {
  return z.array(referenceSchema).max(MAX_VIBES).parse(value);
}
export function applyStylePreset(current: GenerationSettings, preset: StylePreset, append = true): GenerationSettings {
  if (preset.kind === "vibe") {
    if (current.imageSource?.mode === "infill") throw new Error("Vibe Transfer is unavailable during inpainting. Switch to text-to-image or Image2Image first.");
    const vibe = [...(append ? current.vibe : []), ...structuredClone(preset.vibes)];
    const model = compatibleVibeModel(vibe, current.model);
    if (current.characters.filter(character => character.enabled && character.prompt.trim()).length > maxCharacters(model)) throw new Error("This Vibe needs a model with a limit of 6 active characters. Reduce the active characters first.");
    return { ...current, model, vibe, directorReference: [], normalizeReferenceStrength: preset.normalizeReferenceStrength ?? current.normalizeReferenceStrength };
  }
  const result: GenerationSettings = { ...structuredClone(current), ...structuredClone(preset.settings) };
  result.characters = [...(append && preset.kind === "prompt" ? current.characters : []), ...preset.settings.characters.map(character => ({ ...character, id: crypto.randomUUID() }))];
  if (preset.kind === "settings") return { ...result, vibe: [], directorReference: [], imageSource: null };
  if (append) {
    result.prompt = [current.prompt, preset.settings.prompt].filter(Boolean).join(", ");
    result.negativePrompt = [current.negativePrompt, preset.settings.negativePrompt].filter(Boolean).join(", ");
    // Adding an artist string must not change how the existing prompt's quality tags are expanded.
    result.qualityToggle = current.qualityToggle; result.qualityPreset = current.qualityPreset; result.ucPreset = current.ucPreset; result.autoText = current.autoText;
  }
  if (result.characters.filter(character => character.enabled && character.prompt.trim()).length > maxCharacters(result.model)) throw new Error("The combined prompt has too many active characters for this model.");
  return result;
}
