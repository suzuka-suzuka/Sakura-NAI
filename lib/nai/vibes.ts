import { Model, base64ToBytes } from "./protocol";
import { isV4Model, type GenerationModel } from "./models";
import type { ReferenceImage, VibeEncoding } from "./types";

export const MAX_VIBES = 16;
export const VIBE_FILE_ACCEPT = ".naiv4vibe,.naiv4vibebundle";
export const isVibeFile = (name: string) => /\.naiv4vibe(?:bundle)?$/i.test(name);
const modelKeys: Record<string, GenerationModel> = {
  v4full: Model.V4, v4curated: Model.V4_CUR,
  "v4-5full": Model.V4_5, "v4-5curated": Model.V4_5_CUR,
};
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function modelFromKey(value: unknown): GenerationModel | undefined {
  if (typeof value !== "string") return;
  return modelKeys[value] ?? Object.values(modelKeys).find(model => model === value);
}
function unit(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Vibe strengths and information extracted must be between 0 and 1.");
  return value;
}
export function encodedData(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Vibe encoding.");
  const data = value.replace(/^data:application\/octet-stream;base64,/, "").replace(/\s/g, "");
  if (!data || data.length > 8 * 1024 * 1024 || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Invalid Vibe encoding.");
  return data;
}
/** Accept only embedded raster images; importing a preset never loads remote URLs. */
function imageData(value: unknown): { base64: string; preview: string } {
  if (typeof value !== "string" || !value) return { base64: "", preview: "" };
  const data = value.replace(/^data:image\/(?:png|jpeg|webp|gif);base64,/, "").replace(/\s/g, "");
  if (data.length > 64 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Invalid Vibe reference image.");
  const mime = data.startsWith("iVBOR") ? "png" : data.startsWith("/9j/") ? "jpeg" : data.startsWith("UklGR") ? "webp" : data.startsWith("R0lGOD") ? "gif" : "";
  if (!mime) throw new Error("Invalid Vibe reference image.");
  return { base64: data, preview: `data:image/${mime};base64,${data}` };
}

export function vibeEncoding(ref: ReferenceImage, model: GenerationModel): VibeEncoding | undefined {
  return ref.encodings?.find(value => value.model === model && Math.abs(value.informationExtracted - ref.informationExtracted) < 0.000001);
}
export function rememberEncoding(ref: ReferenceImage, encoding: VibeEncoding): ReferenceImage {
  return { ...ref, encodings: [...(ref.encodings ?? []).filter(value => value.model !== encoding.model || Math.abs(value.informationExtracted - encoding.informationExtracted) >= 0.000001), encoding] };
}

function readVibe(value: unknown, fallbackName: string): ReferenceImage {
  const data = record(value);
  if (!data || !["novelai-vibe-transfer", "naiv4vibe"].includes(String(data.identifier)) || data.version !== 1 || !["image", "encoding"].includes(String(data.type))) throw new Error("This is not a supported NovelAI Vibe file.");
  const info = record(data.importInfo);
  const sourceModel = modelFromKey(info?.model);
  const encodings: VibeEncoding[] = [];
  const groups = record(data.encodings);
  for (const [key, variants] of Object.entries(groups ?? {})) {
    const model = modelFromKey(key);
    if (!model) continue;
    for (const [variantKey, variant] of Object.entries(record(variants) ?? {})) {
      const entry = record(variant), params = record(entry?.params);
      if (!entry) throw new Error("Invalid Vibe encoding.");
      encodings.push({ model, informationExtracted: unit(params?.information_extracted, unit(info?.information_extracted, 1)), data: encodedData(entry.encoding), key: variantKey });
      if (encodings.length > 256) throw new Error("This Vibe file contains too many encodings.");
    }
  }
  const image = data.type === "image" ? imageData(data.image) : { base64: "", preview: "" };
  if (!encodings.length && !image.base64) throw new Error("This Vibe has no usable image or supported encoding.");
  const preferred = encodings.find(entry => entry.model === sourceModel) ?? encodings[0];
  const requested = unit(info?.information_extracted, preferred?.informationExtracted ?? 0.7);
  const informationExtracted = image.base64 || encodings.some(entry => entry.model === preferred?.model && entry.informationExtracted === requested) ? requested : preferred.informationExtracted;
  const thumbnail = data.thumbnail ? imageData(data.thumbnail).preview : image.preview;
  return { ...image, preview: thumbnail, name: typeof data.name === "string" ? data.name.slice(0, 200) : fallbackName,
    strength: unit(info?.strength, 0.6), informationExtracted, sourceModel: sourceModel ?? preferred?.model, encodings };
}

/** The official image/encoding variants and bundle envelope, version 1. */
export function parseVibeFile(text: string, filename = "Vibe"): ReferenceImage[] {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("This Vibe file is not valid JSON."); }
  const data = record(value);
  const items = data?.identifier === "novelai-vibe-transfer-bundle" ? data.vibes : [data];
  if (data?.identifier === "novelai-vibe-transfer-bundle" && data.version !== 1) throw new Error("This Vibe file version is not supported.");
  if (!Array.isArray(items) || !items.length || items.length > MAX_VIBES) throw new Error("Use between 1 and 16 Vibe references.");
  return items.map((item, i) => readVibe(item, filename.replace(/\.naiv4vibe(?:bundle)?$/i, "") + (items.length > 1 ? ` ${i + 1}` : "")));
}

export function compatibleVibeModel(refs: ReferenceImage[], current: GenerationModel): GenerationModel {
  if (!refs.length || refs.length > MAX_VIBES) throw new Error("Use between 1 and 16 Vibe references.");
  const candidates = [...new Set([current, ...refs.map(ref => ref.sourceModel).filter((model): model is GenerationModel => !!model), Model.V4_5, Model.V4_5_CUR, Model.V4, Model.V4_CUR])];
  const cached = candidates.find(model => isV4Model(model) && refs.every(ref => vibeEncoding(ref, model) || !ref.encodings?.length && ref.base64));
  if (cached) return cached;
  const possible = candidates.find(model => isV4Model(model) && refs.every(ref => vibeEncoding(ref, model) || ref.base64));
  if (!possible) throw new Error("These Vibes have no compatible model. Import their original reference images separately.");
  return possible;
}

export function vibesFromMetadata(data: Record<string, unknown>, model: GenerationModel): ReferenceImage[] {
  const values = data.reference_image_multiple;
  if (!isV4Model(model) || !Array.isArray(values) || !values.length) return [];
  if (values.length > MAX_VIBES) throw new Error("Use between 1 and 16 Vibe references.");
  const strengths = Array.isArray(data.reference_strength_multiple) ? data.reference_strength_multiple : [];
  const extracted = Array.isArray(data.reference_information_extracted_multiple) ? data.reference_information_extracted_multiple : [];
  return values.map((value, i) => {
    const informationExtracted = unit(extracted[i], 1);
    return { base64: "", preview: "", name: `Vibe ${i + 1}`, strength: unit(strengths[i], 0.6), informationExtracted, sourceModel: model,
      encodings: [{ model, informationExtracted, data: encodedData(value) }] };
  });
}

/** Official PNG exports store a base64-encoded Vibe envelope in the naidata text chunk. */
export function embeddedVibes(entries: { keyword: string; text: string }[]): ReferenceImage[] {
  const embedded = entries.find(entry => entry.keyword.toLowerCase() === "naidata");
  if (!embedded) return [];
  const json = embedded.text.trim().startsWith("{") ? embedded.text : new TextDecoder().decode(base64ToBytes(embedded.text));
  return parseVibeFile(json);
}

async function hashString(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportVibes(refs: ReferenceImage[], model: GenerationModel): Promise<{ text: string; extension: string }> {
  if (!refs.length || refs.length > MAX_VIBES) throw new Error("Use between 1 and 16 Vibe references.");
  const vibes = await Promise.all(refs.map(async (ref, i) => {
    if (!ref.encodings?.length) throw new Error("Generate once to encode this reference before exporting it.");
    const encodings: Record<string, Record<string, unknown>> = {};
    const selected = vibeEncoding(ref, model) ?? ref.encodings.find(encoding => encoding.model === ref.sourceModel && encoding.informationExtracted === ref.informationExtracted) ?? ref.encodings[0];
    for (const encoding of ref.base64 ? ref.encodings : [selected]) {
      const key = Object.keys(modelKeys).find(key => modelKeys[key] === encoding.model);
      if (!key) continue;
      const variantKey = ref.base64 ? encoding.key ?? await hashString(`information_extracted:${encoding.informationExtracted}`) : "unknown";
      (encodings[key] ??= {})[variantKey] = { encoding: encoding.data, params: { information_extracted: encoding.informationExtracted } };
    }
    return { identifier: "novelai-vibe-transfer", version: 1, type: ref.base64 ? "image" : "encoding",
      ...(ref.base64 ? { image: ref.base64 } : {}), id: await hashString(ref.base64 || selected.data), encodings, name: ref.name ?? `Vibe ${i + 1}`,
      ...(ref.preview ? { thumbnail: ref.preview } : {}), createdAt: new Date().toISOString(),
      importInfo: { model: selected.model, information_extracted: ref.base64 ? ref.informationExtracted : selected.informationExtracted, strength: ref.strength } };
  }));
  return { text: JSON.stringify(vibes.length === 1 ? vibes[0] : { identifier: "novelai-vibe-transfer-bundle", version: 1, vibes }), extension: vibes.length === 1 ? ".naiv4vibe" : ".naiv4vibeBundle" };
}
