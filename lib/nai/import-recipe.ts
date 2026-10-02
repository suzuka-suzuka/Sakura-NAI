import { extractImageMetadata } from "./media";
import { Model, Noise, Sampler } from "./protocol";
import { MODEL_OPTIONS, NOISE_OPTIONS, SAMPLER_OPTIONS, V5_FULL, V5_CURATED, type GenerationModel } from "./models";
import { DEFAULT_SETTINGS, type CharacterSetting, type GenerationSettings } from "./types";

type UnknownRecord = Record<string, unknown>;

export type ImportedRecipe = {
  settings: GenerationSettings;
  importedFields: string[];
  omittedReferences: boolean;
  reproductionWarnings: ("img2img" | "infill" | "edited")[];
  imageSettings?: { mode: "img2img" | "infill"; strength: number; noise: number; inpaintStrength: number; focused: boolean };
};

async function readPngDimensions(file: Blob) {
  // Width and height are two big-endian uint32s in PNG's IHDR chunk. Reading only these eight
  // bytes avoids decoding/base64-encoding the entire image a second time after metadata extraction.
  const header = await file.slice(16, 24).arrayBuffer();
  if (header.byteLength !== 8) return { width: DEFAULT_SETTINGS.width, height: DEFAULT_SETTINGS.height };
  const view = new DataView(header);
  return { width: view.getUint32(0), height: view.getUint32(4) };
}

const MODEL_VALUES = new Set(MODEL_OPTIONS.map((option) => option.value));
const SAMPLER_VALUES = new Set(SAMPLER_OPTIONS.map((option) => option.value));
const NOISE_VALUES = new Set(NOISE_OPTIONS.map((option) => option.value));
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Flatten JSON-bearing PNG chunks (especially NovelAI's Comment chunk) into one alias-friendly map. */
function metadataBag(entries: { keyword: string; text: string }[]) {
  const bag = new Map<string, unknown>();
  const merge = (value: UnknownRecord) => {
    for (const [name, nested] of Object.entries(value)) bag.set(key(name), nested);
  };

  for (const entry of entries) {
    const parsed = jsonOrText(entry.text);
    bag.set(key(entry.keyword), parsed);
    const parsedRecord = record(parsed);
    if (parsedRecord) merge(parsedRecord);
  }
  return bag;
}

function pick(bag: Map<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = bag.get(key(name));
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function readModel(value: unknown): GenerationModel | null {
  const raw = text(value)?.replace(/-inpainting$/i, "");
  if (!raw) return null;
  if (MODEL_VALUES.has(raw as GenerationModel)) return raw as GenerationModel;

  const normalized = raw.toLowerCase();
  const curated = normalized.includes("curated");
  if (/diffusion[- ]?5|\bv5\b/.test(normalized)) return curated ? V5_CURATED : V5_FULL;
  if (normalized.includes("furry") || normalized.includes("4be8c60c")) return Model.FURRY;
  if (normalized.includes("4.5") || normalized.includes("v4_5")) return curated ? Model.V4_5_CUR : Model.V4_5;
  if (normalized.includes("diffusion v4") || normalized.includes("diffusion-4") || normalized.includes(" v4")) {
    return curated ? Model.V4_CUR : Model.V4;
  }
  if (normalized.includes("anime v3") || normalized.includes("c1e1de52")) return Model.V3;
  return null;
}

function readCharacters(bag: Map<string, unknown>): CharacterSetting[] {
  const direct = pick(bag, "characterPrompts", "character_prompts");
  if (Array.isArray(direct)) {
    return direct.flatMap((item) => {
      const char = record(item);
      const prompt = text(char?.prompt);
      if (!char || !prompt) return [];
      const center = record(char.center);
      return [{
        prompt,
        uc: text(char.uc) ?? "",
        enabled: boolean(char.enabled) ?? true,
        center: {
          x: clamp(number(center?.x) ?? 0.5, 0, 1),
          y: clamp(number(center?.y) ?? 0.5, 0, 1),
        },
      }];
    });
  }

  // NovelAI V4 PNGs commonly store the already-expanded v4_prompt structures rather than the
  // SDK's friendlier characterPrompts array. Pair positive/negative captions by index.
  const positive = record(pick(bag, "v4_prompt"));
  const negative = record(pick(bag, "v4_negative_prompt"));
  const positiveCaption = record(positive?.caption);
  const negativeCaption = record(negative?.caption);
  const positiveChars = Array.isArray(positiveCaption?.char_captions) ? positiveCaption.char_captions : [];
  const negativeChars = Array.isArray(negativeCaption?.char_captions) ? negativeCaption.char_captions : [];

  return positiveChars.flatMap((item, index) => {
    const char = record(item);
    const prompt = text(char?.char_caption);
    if (!char || !prompt) return [];
    const negativeChar = record(negativeChars[index]);
    const centers = Array.isArray(char.centers) ? char.centers : [];
    const center = record(centers[0]);
    return [{
      prompt,
      uc: text(negativeChar?.char_caption) ?? "",
      enabled: true,
      center: {
        x: clamp(number(center?.x) ?? 0.5, 0, 1),
        y: clamp(number(center?.y) ?? 0.5, 0, 1),
      },
    }];
  });
}

/** Map extracted NovelAI entries into the subset supported by Sakura NAI's generation form. */
export function recipeFromNovelAIMetadata(
  entries: { keyword: string; text: string }[],
  image: { width: number; height: number },
): ImportedRecipe {
  const bag = metadataBag(entries);
  const settings: GenerationSettings = {
    ...DEFAULT_SETTINGS,
    characters: [],
    vibe: [],
    directorReference: [],
  };
  const imported = new Set<string>();

  const v4Prompt = record(pick(bag, "v4_prompt"));
  const v4NegativePrompt = record(pick(bag, "v4_negative_prompt"));
  const v4PromptCaption = record(v4Prompt?.caption);
  const v4NegativeCaption = record(v4NegativePrompt?.caption);
  const rawPrompt = pick(bag, "prompt", "description", "positivePrompt", "positive_prompt");
  const prompt = text(rawPrompt)
    ?? text(v4PromptCaption?.base_caption);
  if (prompt || rawPrompt === "") {
    settings.prompt = prompt ?? "";
    imported.add("prompt");
  }

  const rawNegative = pick(bag, "uc", "negativePrompt", "negative_prompt");
  const negativePrompt = text(rawNegative)
    ?? text(v4NegativeCaption?.base_caption);
  if (negativePrompt || rawNegative === "") {
    settings.negativePrompt = negativePrompt?.toLowerCase() === "none" ? "" : negativePrompt ?? "";
    imported.add("undesired content");
  }

  const model = readModel(pick(bag, "model", "source"));
  if (model) {
    settings.model = model;
    imported.add("model");
  }

  const width = number(pick(bag, "width")) ?? image.width;
  const height = number(pick(bag, "height")) ?? image.height;
  if (width >= 64 && width <= 2048 && height >= 64 && height <= 2048) {
    settings.width = Math.round(width);
    settings.height = Math.round(height);
    imported.add("resolution");
  }

  const steps = number(pick(bag, "steps"));
  if (steps !== null) {
    settings.steps = Math.round(clamp(steps, 1, 50));
    imported.add("steps");
  }

  const seed = number(pick(bag, "seed"));
  if (seed !== null && seed >= 0) {
    settings.seed = Math.round(clamp(seed, 0, 4294967295));
    imported.add("seed");
  }

  const sampler = text(pick(bag, "sampler"));
  if (sampler && SAMPLER_VALUES.has(sampler as Sampler)) {
    settings.sampler = sampler as Sampler;
    imported.add("sampler");
  }

  const scale = number(pick(bag, "scale", "cfgScale", "cfg_scale"));
  if (scale !== null) {
    settings.scale = clamp(scale, 1, 10);
    imported.add("guidance");
  }

  const cfgRescale = number(pick(bag, "cfgRescale", "cfg_rescale"));
  if (cfgRescale !== null) {
    settings.cfgRescale = clamp(cfgRescale, 0, 1);
    imported.add("guidance rescale");
  }

  const noise = text(pick(bag, "noiseSchedule", "noise_schedule"));
  if (noise && NOISE_VALUES.has(noise as Noise)) {
    settings.noiseSchedule = noise as Noise;
    imported.add("noise schedule");
  }

  const ucPreset = number(pick(bag, "ucPreset", "uc_preset"));
  if (ucPreset !== null && ucPreset >= 0 && ucPreset <= 4) {
    settings.ucPreset = Math.round(ucPreset) as GenerationSettings["ucPreset"];
    imported.add("UC preset");
  }

  const quality = boolean(pick(bag, "qualityToggle", "quality_toggle"));
  if (quality !== null) {
    settings.qualityToggle = quality;
    imported.add("quality tags");
  }

  const qualityPreset = text(pick(bag, "qualityPreset", "quality_preset"));
  if (qualityPreset === "standard" || qualityPreset === "light" || qualityPreset === "none") {
    settings.qualityPreset = qualityPreset;
    settings.qualityToggle = qualityPreset !== "none";
    imported.add("quality tags");
  }
  const samples = number(pick(bag, "nSamples", "n_samples"));
  if (samples !== null) {
    settings.nSamples = Math.round(clamp(samples, 1, 8));
    imported.add("batch size");
  }

  const dynamicThresholding = boolean(pick(bag, "dynamicThresholding", "dynamic_thresholding"));
  if (dynamicThresholding !== null) {
    settings.dynamicThresholding = dynamicThresholding;
    imported.add("dynamic thresholding");
  }

  const autoSmea = boolean(pick(bag, "autoSmea", "auto_smea", "sm"));
  const variety = boolean(pick(bag, "varietyPlus", "variety_plus"));
  const sigma = number(pick(bag, "skip_cfg_above_sigma"));
  if (variety !== null || sigma !== null) {
    settings.varietyPlus = variety ?? (sigma! > 0);
    imported.add("Variety+");
  }
  if (autoSmea !== null) {
    settings.autoSmea = autoSmea;
    imported.add("SMEA");
  }

  const coords = boolean(pick(bag, "use_coords")) ?? boolean(v4Prompt?.use_coords);
  if (coords !== null) settings.useCoords = coords;
  const transparent = boolean(pick(bag, "tag_hint_transparent_background", "transparentBackground"));
  if (transparent !== null) settings.transparentBackground = transparent;
  const autoText = boolean(pick(bag, "autoText"));
  if (autoText !== null) settings.autoText = autoText;
  // PNG captions already contain expanded quality/UC text. Avoid appending them again.
  if (quality === null && qualityPreset === null && prompt) settings.qualityToggle = false;
  if (ucPreset === null && negativePrompt) settings.ucPreset = 3;
  const characters = readCharacters(bag);
  if (characters.length || Array.isArray(pick(bag, "characterPrompts", "character_prompts")) || Array.isArray(v4PromptCaption?.char_captions)) {
    settings.characters = characters;
    imported.add(`${characters.length} character${characters.length === 1 ? "" : "s"}`);
  }

  const omittedReferences = [
    pick(bag, "reference_image_multiple"),
    pick(bag, "reference_strength_multiple"),
    pick(bag, "director_reference_images"),
    pick(bag, "director_reference_strength_values"),
  ].some((value) => Array.isArray(value) && value.length > 0);

  // Official exports may identify the request by name or only by its image-input parameters.
  const request = String(pick(bag, "action", "request_type", "requestType") ?? "") + " " + String(pick(bag, "source", "model") ?? "");
  const inpaintStrength = number(pick(bag, "inpaintImg2ImgStrength", "inpaint_strength"));
  const strength = number(pick(bag, "strength"));
  const infill = /infill|inpaint/i.test(request) || inpaintStrength !== null;
  const img2img = !infill && (/img2img|image2image|image.to.image/i.test(request) || strength !== null);
  const reproductionWarnings: ImportedRecipe["reproductionWarnings"] = [];
  if (infill) reproductionWarnings.push("infill");
  if (img2img) reproductionWarnings.push("img2img");
  if (boolean(pick(bag, "sakura_canvas_edited"))) reproductionWarnings.push("edited");
  const imageSettings: ImportedRecipe["imageSettings"] = infill || img2img ? {
    mode: infill ? "infill" : "img2img", strength: clamp(strength ?? 0.7, 0, 1),
    noise: clamp(number(pick(bag, "noise")) ?? 0, 0, 1),
    inpaintStrength: clamp(inpaintStrength ?? 1, 0, 1), focused: boolean(pick(bag, "focused")) ?? false,
  } : undefined;

  if (imported.size === 0) throw new Error("NovelAI metadata was found, but it contains no supported generation settings.");
  return { settings, importedFields: [...imported], omittedReferences, reproductionWarnings, imageSettings };
}

export function recipeReproductionMessage(recipe: ImportedRecipe): string | null {
  if (recipe.reproductionWarnings.includes("infill"))
    return "This image was generated using inpainting. You can import its parameters, but reproducing it also requires the original base image and mask.";
  if (recipe.reproductionWarnings.includes("img2img"))
    return "This image was generated using Image2Image. You can import its parameters, but reproducing it also requires the original base image.";
  if (recipe.reproductionWarnings.includes("edited"))
    return "This image was cropped or edited. Its generation parameters were kept, but those parameters alone cannot reproduce the edited image.";
  return null;
}

/** Extract a generation recipe from NovelAI PNG text chunks or stealth metadata. */
export async function importNovelAIRecipe(file: File | Blob): Promise<ImportedRecipe> {
  // Preserve original PNG bytes, including metadata.
  const png = file.type === "image/png" ? file : file.slice(0, file.size, "image/png");
  const [metadata, image] = await Promise.all([extractImageMetadata(png), readPngDimensions(png)]);
  if (metadata.type !== "NOVELAI" || metadata.entries.length === 0) {
    throw new Error("No NovelAI generation metadata was found in this image.");
  }
  return recipeFromNovelAIMetadata(metadata.entries, image);
}
