import { Sampler, Noise } from "./protocol";
import type { QualityPreset, NegativePreset } from "./presets";
import { type GenerationModel } from "./models";

// ---- App-facing generation settings (mirrors the form; serializable for the gallery) ----

export type CharacterSetting = {
  id?: string;
  name?: string;
  collapsed?: boolean;
  prompt: string;
  uc: string;
  center: { x: number; y: number };
  enabled: boolean;
};

export type ImageSource = {
  dataUrl: string;
  width: number;
  height: number;
  mode: "img2img" | "infill";
  mask?: string;
  strength: number;
  noise: number;
  inpaintStrength: number;
  /** V5 Enhance Max: source-size request, expanded output and billing canvas. */
  upscaledEnhance?: boolean;
};

export type ReferenceImage = {
  /** base64 (no data-url prefix) as returned by parseImage */
  base64: string;
  /** small data-url for previewing in the form */
  preview: string;
  strength: number;
  informationExtracted: number;
};

export type GenerationSettings = {
  prompt: string;
  negativePrompt: string;
  model: GenerationModel;
  promptMode?: "anime" | "furry";
  width: number;
  height: number;
  steps: number;
  /** -1 means "random each generation" */
  seed: number;
  sampler: Sampler;
  scale: number;
  cfgRescale: number;
  noiseSchedule: Noise;
  ucPreset: NegativePreset;
  qualityToggle: boolean;
  qualityPreset?: QualityPreset;
  nSamples: number;
  dynamicThresholding: boolean;
  autoSmea: boolean;
  transparentBackground: boolean;
  autoText: boolean;
  useCoords: boolean;
  characters: CharacterSetting[];
  vibe: ReferenceImage[];
  directorReference: ReferenceImage[];
  imageSource?: ImageSource | null;
};

export const DEFAULT_SETTINGS: GenerationSettings = {
  prompt: "",
  negativePrompt: "",
  model: "nai-diffusion-5-full",
  promptMode: "anime",
  width: 832,
  height: 1216,
  steps: 28,
  seed: -1,
  sampler: Sampler.EULER_ANC,
  scale: 5,
  cfgRescale: 0,
  noiseSchedule: Noise.KARRAS,
  ucPreset: 0,
  qualityToggle: true,
  qualityPreset: "light",
  nSamples: 1,
  dynamicThresholding: false,
  autoSmea: false,
  transparentBackground: false,
  autoText: true,
  useCoords: false,
  characters: [],
  vibe: [],
  directorReference: [],
  imageSource: null,
};
