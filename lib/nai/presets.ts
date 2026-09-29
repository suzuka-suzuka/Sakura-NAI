import type { GenerationSettings } from "./types";

// NovelAI's V5 Full/Curated preset lists, checked 2026-09-28.
// https://docs.novelai.net/en/image/qualitytags/
// https://docs.novelai.net/en/image/undesiredcontent/
export type QualityPreset = "standard" | "light" | "none";
export type NegativePreset = 0 | 1 | 2 | 3 | 4; // Keep legacy 2=human, 3=none.
export const QUALITY_PRESETS = [
  { value: "standard", label: "Standard quality", text: "very aesthetic, masterpiece, no text" },
  { value: "light", label: "Light quality", text: "very aesthetic, amazing quality, no text" },
  { value: "none", label: "Off", text: "" },
] satisfies { value: QualityPreset; label: string; text: string }[];
const heavy = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
export const NEGATIVE_PRESETS = [
  { value: 0, label: "Heavy", text: heavy },
  { value: 1, label: "Light negative", text: "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::" },
  { value: 4, label: "Furry Focus", text: "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic" },
  { value: 2, label: "Human Focus", text: `${heavy}, @_@, mismatched pupils, glowing eyes, bad anatomy` },
  { value: 3, label: "Off", text: "" },
] satisfies { value: NegativePreset; label: string; text: string }[];

// Read old recipes without changing what their on/off quality switch meant.
export function qualityPreset(s: Pick<GenerationSettings, "qualityToggle" | "qualityPreset">): QualityPreset {
  return s.qualityToggle === false ? "none" : s.qualityPreset ?? "standard";
}
export const qualityText = (s: Pick<GenerationSettings, "qualityToggle" | "qualityPreset">) =>
  QUALITY_PRESETS.find(p => p.value === qualityPreset(s))?.text ?? "";
export const negativeText = (s: Pick<GenerationSettings, "ucPreset">) =>
  NEGATIVE_PRESETS.find(p => p.value === s.ucPreset)?.text ?? "";
