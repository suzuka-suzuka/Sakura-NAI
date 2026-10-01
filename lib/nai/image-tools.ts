import { DEFAULT_SETTINGS, type GenerationSettings } from "./types";
import { generationSize, isV5Model } from "./models";

export type EnhanceFactor = 1 | 1.5 | 2 | "max";
type ToolImage = { dataUrl: string; settings: GenerationSettings };
export type Enhancement = {
  source: ToolImage;
  factor: EnhanceFactor;
  magnitude: number;
  strength: number;
  noise: number;
  advanced: boolean;
};
export const ENHANCE_LEVELS = [
  { strength: 0.2, noise: 0 }, { strength: 0.4, noise: 0 },
  { strength: 0.5, noise: 0 }, { strength: 0.6, noise: 0 },
  { strength: 0.7, noise: 0.1 },
] as const;
export const MAX_ENHANCE_PIXELS = 3145728;

export function enhanceFactors(source: ToolImage, model: GenerationSettings["model"]): EnhanceFactor[] {
  const { width, height } = generationSize(source.settings.width, source.settings.height);
  const factors: EnhanceFactor[] = ([1, 1.5, 2] as const).filter(factor => {
    const w = Math.round(width * factor / 64) * 64, h = Math.round(height * factor / 64) * 64;
    return w <= 2048 && h <= 2048 && w * h <= MAX_ENHANCE_PIXELS;
  });
  if (isV5Model(model) && width * height < MAX_ENHANCE_PIXELS * 0.8) factors.push("max");
  return factors;
}

export function resolveEnhanceFactor(enhancement: Enhancement, model: GenerationSettings["model"]): EnhanceFactor {
  const factors = enhanceFactors(enhancement.source, model);
  return factors.includes(enhancement.factor) ? enhancement.factor : factors[factors.length - 1];
}

/** Max sends the source canvas, but pricing and output use the expanded 3 MP canvas. */
export function imageToolOutputSize(s: GenerationSettings) {
  if (s.imageSource?.mode === "infill" && s.imageSource.focused)
    return { width: s.imageSource.width, height: s.imageSource.height };
  if (!isV5Model(s.model) || s.imageSource?.mode !== "img2img" || !s.imageSource.upscaledEnhance)
    return { width: s.width, height: s.height };
  const factor = Math.sqrt(MAX_ENHANCE_PIXELS / (s.width * s.height));
  return { width: Math.round(s.width * factor), height: Math.round(s.height * factor) };
}

export function activeGenerationSettings(settings: GenerationSettings, enhancement: Enhancement | null): GenerationSettings {
  return enhancement ? imageToolSettings(enhancement.source, "enhance", {
    ...enhancement, factor: resolveEnhanceFactor(enhancement, settings.model), settings,
  }) : settings;
}

/** Keep Enhance's visual tags outside a manual text-rendering block. */
export function enhancePrompt(prompt: string) {
  if (prompt.includes("upscaled, blurry")) return prompt;
  const addition = ", -2::upscaled, blurry::,";
  const match = /(?:^|[\n,])\s*text\s*:(?!:)/i.exec(prompt);
  const at = match?.index ?? prompt.length;
  return prompt.slice(0, at) + addition + prompt.slice(at);
}

/** Shared by the toolbar quote, options dialog and generation submission. */
export function imageToolSettings(source: ToolImage, kind: "enhance" | "variations", options: { factor?: EnhanceFactor; strength?: number; noise?: number; settings?: GenerationSettings } = {}): GenerationSettings {
  const factor = kind === "variations" ? 1 : options.factor ?? 1;
  const canvas = generationSize(source.settings.width, source.settings.height);
  const multiplier = factor === "max" ? 1 : factor;
  const settings = kind === "enhance" ? options.settings ?? source.settings : source.settings;
  return {
    ...DEFAULT_SETTINGS, ...settings,
    prompt: kind === "enhance" && factor !== "max" && (isV5Model(settings.model) || settings.model.includes("4-5")) ? enhancePrompt(settings.prompt) : settings.prompt,
    width: Math.round(canvas.width * multiplier / 64) * 64,
    height: Math.round(canvas.height * multiplier / 64) * 64,
    seed: -1, nSamples: kind === "variations" ? 4 : 1,
    imageSource: { dataUrl: source.dataUrl, width: source.settings.width, height: source.settings.height, mode: "img2img", strength: options.strength ?? 0.5, noise: options.noise ?? 0, inpaintStrength: 1,
      ...(factor === "max" ? { upscaledEnhance: true } : {}) },
  };
}
