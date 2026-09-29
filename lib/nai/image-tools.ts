import { DEFAULT_SETTINGS, type GenerationSettings } from "./types";

/** Shared by the toolbar quote, options dialog and generation submission. */
export function imageToolSettings(source: { dataUrl: string; settings: GenerationSettings }, kind: "enhance" | "variations", options: { factor?: number; strength?: number; noise?: number } = {}): GenerationSettings {
  const factor = kind === "variations" ? 1 : options.factor ?? 1;
  return {
    ...DEFAULT_SETTINGS, ...source.settings,
    width: Math.round(source.settings.width * factor / 64) * 64,
    height: Math.round(source.settings.height * factor / 64) * 64,
    seed: -1, nSamples: kind === "variations" ? 4 : 1,
    imageSource: { dataUrl: source.dataUrl, width: source.settings.width, height: source.settings.height, mode: "img2img", strength: options.strength ?? 0.5, noise: options.noise ?? 0, inpaintStrength: 1 },
  };
}
