import { base64ToBytes, bytesToBase64, type GenerationPayload } from "./protocol";
import { extractImageMetadata } from "./media";

export type MetadataEntry = { keyword: string; text: string };
const utf8 = new TextEncoder();
const decode = new TextDecoder();
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
export const isPng = (bytes: Uint8Array) => signature.every((value, i) => bytes[i] === value);
export function pngSize(bytes: Uint8Array) {
  if (!isPng(bytes) || bytes.length < 33 || decode.decode(bytes.subarray(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function textChunk(entry: MetadataEntry) {
  // Uncompressed iTXt supports Chinese prompts without changing any image pixels.
  const content = utf8.encode(`${entry.keyword}\0\0\0\0\0${entry.text}`);
  const chunk = new Uint8Array(content.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, content.length);
  chunk.set(utf8.encode("iTXt"), 4); chunk.set(content, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

/** Replace text chunks by keyword, preserving the original IDAT bytes and their CRCs. */
export function writePngMetadata(bytes: Uint8Array, entries: MetadataEntry[]) {
  if (!pngSize(bytes)) throw new Error("Invalid PNG header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const replaced = new Set(entries.map(entry => entry.keyword));
  const parts = [bytes.subarray(0, 8)];
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), end = offset + length + 12;
    if (end > bytes.length) throw new Error("Truncated PNG chunk");
    const type = decode.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") {
      parts.push(...entries.map(textChunk), bytes.subarray(offset, end));
      ended = true; break;
    }
    const data = bytes.subarray(offset + 8, end - 4);
    const keywordEnd = data.indexOf(0);
    const replacedText = ["tEXt", "zTXt", "iTXt"].includes(type) && keywordEnd > 0 && replaced.has(decode.decode(data.subarray(0, keywordEnd)));
    if (!replacedText) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!ended) throw new Error("PNG is missing IEND");
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function readEntries(bytes: Uint8Array) {
  try { return (await extractImageMetadata(new Blob([new Uint8Array(bytes)]))).entries; }
  catch { return []; } // Damaged optional metadata must not prevent saving a finished image.
}
function commentObject(entries: MetadataEntry[]): Record<string, unknown> {
  try {
    const value = JSON.parse(entries.find(entry => entry.keyword === "Comment")?.text ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

// Explicit allowlist: input images, masks, encoded references, tokens and URLs never enter PNGs.
const parameterKeys = [
  "params_version", "steps", "scale", "sampler", "noise_schedule", "cfg_rescale", "n_samples",
  "dynamic_thresholding", "sm", "sm_dyn", "skip_cfg_above_sigma", "use_coords",
  "v4_prompt", "v4_negative_prompt", "characterPrompts", "tag_hint_transparent_background",
  "strength", "noise", "extra_noise_seed", "inpaintImg2ImgStrength", "img2img", "upscaled_enhance",
  "reference_strength_multiple", "reference_information_extracted_multiple",
  "director_reference_strength_values", "director_reference_information_extracted",
] as const;

/** Save the effective request recipe even if the source/upstream image had no metadata. */
export async function generationPngMetadata(output: Uint8Array, payload: GenerationPayload, sampleIndex: number, upstream = output, focused = false) {
  const size = pngSize(output);
  if (!size) return output; // Non-PNG previews/tools are outside this writer's scope.
  const previous = commentObject(await readEntries(upstream));
  const parameters: Record<string, unknown> = {};
  for (const name of parameterKeys) if (payload.parameters[name] !== undefined) parameters[name] = payload.parameters[name];
  const upstreamSeed = previous.seed;
  const seed = Number.isInteger(upstreamSeed) && Number(upstreamSeed) >= 0 && Number(upstreamSeed) <= 4294967295
    ? upstreamSeed : (Number(payload.parameters.seed) + sampleIndex) >>> 0;
  const comment = {
    ...parameters, ...size, model: payload.model, action: payload.action, seed,
    prompt: payload.input, uc: payload.parameters.negative_prompt ?? "",
    // Captions contain the effective expanded tags already; importing must not append them twice.
    qualityToggle: false, qualityPreset: "none", ucPreset: 3, autoText: false,
    request_width: payload.parameters.width, request_height: payload.parameters.height,
    ...(focused ? { focused: true } : {}),
  };
  return writePngMetadata(output, [
    { keyword: "Software", text: "Sakura NAI (NovelAI compatible)" },
    { keyword: "Source", text: payload.model },
    { keyword: "Description", text: payload.input },
    { keyword: "Comment", text: JSON.stringify(comment) },
  ]);
}

/** Carry generation data through canvas edits. An ungenerated image stays without a recipe. */
export async function preserveCanvasMetadata(outputUrl: string, sourceUrl: string | null, edited = true) {
  if (!sourceUrl) return outputUrl;
  const output = base64ToBytes(outputUrl), size = pngSize(output);
  if (!size) return outputUrl;
  const source = base64ToBytes(sourceUrl);
  const entries = await readEntries(source);
  // Never transfer authenticity signatures to changed pixels.
  const retained = entries.filter(entry => ["Software", "Source", "Description", "Comment"].includes(entry.keyword));
  if (!retained.length) return outputUrl;
  const comment = commentObject(entries);
  if (edited) {
    const originalSize = pngSize(source);
    Object.assign(comment, {
      sakura_canvas_edited: true,
      sakura_original_width: comment.sakura_original_width ?? comment.width ?? originalSize?.width,
      sakura_original_height: comment.sakura_original_height ?? comment.height ?? originalSize?.height,
      ...size,
    });
  }
  const commentIndex = retained.findIndex(entry => entry.keyword === "Comment");
  if (commentIndex >= 0) retained[commentIndex] = { keyword: "Comment", text: JSON.stringify(comment) };
  else if (edited) retained.push({ keyword: "Comment", text: JSON.stringify(comment) });
  return `data:image/png;base64,${bytesToBase64(writePngMetadata(output, retained))}`;
}
