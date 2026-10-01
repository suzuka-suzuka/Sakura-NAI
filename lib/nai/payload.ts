import { isV4Model, isV5Model, maxCharacters } from "./models";
import { Model, Sampler, type GenerationPayload } from "./protocol";
import type { GenerationSettings } from "./types";
import { qualityText, negativeText } from "./presets";
import { buildV5Payload } from "./v5";
import { applyImageInput } from "./image-input";

export function buildPayload(s: GenerationSettings, seed: number): GenerationPayload {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("Invalid generation seed");
  if (!Number.isFinite(s.cfgRescale) || s.cfgRescale < 0 || s.cfgRescale > 1) throw new Error("Guidance rescale must be between 0 and 1");
  if (isV5Model(s.model)) return applyImageInput(buildV5Payload(s, seed), s, seed);
  if (!Object.values(Model).includes(s.model)) throw new Error("Unsupported image model");
  if (![s.width, s.height].every(n => Number.isInteger(n) && n >= 64 && n <= 2048 && n % 64 === 0)) throw new Error("Image dimensions must be multiples of 64");
  if (s.width * s.height > 3145728) throw new Error("Image dimensions must not exceed 3,145,728 pixels");
  if (!Number.isInteger(s.nSamples) || s.nSamples < 1 || s.nSamples > 8) throw new Error("Invalid batch size");
  const modern = isV4Model(s.model);
  const chars = s.characters.filter(c => c.enabled && c.prompt.trim());
  if (chars.length > maxCharacters(s.model)) throw new Error(`This model supports at most ${maxCharacters(s.model)} enabled characters`);
  const prompt = modern && s.promptMode === "furry" && !/^\s*fur dataset\b/i.test(s.prompt) ? `fur dataset, ${s.prompt}` : s.prompt;
  const input = [prompt, qualityText(s)].filter(Boolean).join(", ");
  const negative = [negativeText(s), s.negativePrompt].filter(Boolean).join(", ");
  const parameters: Record<string, unknown> = {
    params_version: 3, width: s.width, height: s.height, seed, steps: s.steps, scale: s.scale,
    n_samples: s.nSamples, sampler: modern && s.sampler === Sampler.DDIM ? Sampler.EULER_ANC : s.sampler,
    noise_schedule: s.noiseSchedule, cfg_rescale: s.cfgRescale,
    negative_prompt: negative, ucPreset: s.ucPreset, qualityToggle: s.qualityToggle,
    sm: !modern && s.autoSmea, sm_dyn: false, dynamic_thresholding: !modern && s.dynamicThresholding,
    legacy: false, legacy_v3_extend: false, add_original_image: true,
  };
  if (s.varietyPlus) parameters.skip_cfg_above_sigma = (s.model === Model.V4_5 || s.model === Model.V4_5_CUR ? 58 : 19) * Math.sqrt(s.width * s.height / (832 * 1216));
  if (modern) {
    const useCoords = s.useCoords !== false && chars.length > 0;
    parameters.use_coords = useCoords;
    parameters.v4_prompt = { caption: { base_caption: input, char_captions: chars.map(c => ({ char_caption: c.prompt, centers: [c.center] })) }, use_coords: useCoords, use_order: true };
    parameters.v4_negative_prompt = { caption: { base_caption: negative, char_captions: chars.map(c => ({ char_caption: c.uc, centers: [c.center] })) }, legacy_uc: false };
    parameters.stream = "msgpack";
  }
  return applyImageInput({ input, model: s.model, action: "generate", parameters }, s, seed);
}
