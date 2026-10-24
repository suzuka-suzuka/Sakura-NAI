import { gunzipSync, unzlibSync } from "fflate";
import { base64ToBytes, bytesToBase64 } from "./protocol";
import { decodeImage } from "./image-decode";
import { readContainerExif, readExifMetadata } from "./exif-metadata";

export async function parseImage(blob: Blob) {
  const bitmap = await decodeImage(blob);
  try {
    // Keep PNG pixels and metadata intact when merely uploading; canvas export discards both
    // text chunks and alpha-channel metadata. Other formats still normalize to PNG below.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value))
      return { base64: bytesToBase64(bytes), width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Unable to decode image");
      ctx.drawImage(bitmap.source, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("The image is too large to import on this device.");
      return { base64: dataUrl.split(",")[1], width: bitmap.width, height: bitmap.height };
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { bitmap.close(); }
}

/** Fit character references into the service's supported canvas, without cropping. */
export async function prepareDirectorReference(base64: string) {
  const bitmap = await decodeImage(new Blob([new Uint8Array(base64ToBytes(base64))]));
  try {
    const ratio = bitmap.width / bitmap.height;
    const [width, height] = ratio > 1.2 ? [1536, 1024] : ratio < 0.8 ? [1024, 1536] : [1472, 1472];
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Unable to prepare reference image");
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / bitmap.width, height / bitmap.height);
      const w = bitmap.width * scale, h = bitmap.height * scale;
      ctx.drawImage(bitmap.source, (width - w) / 2, (height - h) / 2, w, h);
      const url = canvas.toDataURL("image/png");
      if (!url.startsWith("data:image/png;base64,")) throw new Error("Unable to prepare reference image");
      return url.split(",")[1];
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { bitmap.close(); }
}

type Entry = { keyword: string; text: string };
const utf8 = new TextDecoder();
const latin1 = new TextDecoder("latin1");
const isNovelAI = (entries: Entry[]) => entries.some(e => /novelai|nai-diffusion/i.test(e.text) ||
  e.keyword === "Comment" && /"(?:steps|v4_prompt|sampler|prompt|seed)"\s*:/.test(e.text));
function hasPrompt(entries: Entry[]) {
  return entries.some(e => {
    if (e.keyword === "Description" && e.text.trim()) return true;
    if (e.keyword !== "Comment") return false;
    try {
      const info = JSON.parse(e.text);
      return typeof info?.prompt === "string" || typeof info?.v4_prompt?.caption?.base_caption === "string";
    } catch { return false; }
  });
}
function hasParameters(entries: Entry[]) {
  return entries.some(e => {
    if (e.keyword !== "Comment") return false;
    try {
      const info = JSON.parse(e.text);
      return info && typeof info === "object" && ["steps", "seed", "sampler", "scale", "v4_prompt"].some(key => key in info);
    } catch { return false; }
  });
}
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

/** Read file metadata before decoding pixels, regardless of the picker-supplied MIME type. */
export async function extractImageMetadata(blob: Blob): Promise<{ type: string; entries: Entry[] }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    const entries = readContainerExif(bytes);
    return { type: isNovelAI(entries) ? "NOVELAI" : "UNKNOWN", entries };
  }
  const view = new DataView(bytes.buffer), entries: Entry[] = [], idat: Uint8Array[] = [];
  let metadataError: unknown;
  const width = view.getUint32(16), height = view.getUint32(20);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const type = utf8.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idat.push(data);
    try {
      if (type === "eXIf") entries.push(...readExifMetadata(data));
      if (["tEXt", "zTXt", "iTXt"].includes(type)) {
        const end = data.indexOf(0);
        if (end > 0) {
          const keyword = latin1.decode(data.subarray(0, end));
          let text = "";
          if (type === "tEXt") text = utf8.decode(data.subarray(end + 1));
          if (type === "zTXt" && data[end + 1] === 0) text = utf8.decode(unzlibSync(data.subarray(end + 2)));
          if (type === "iTXt") {
            const languageEnd = data.indexOf(0, end + 3), translatedEnd = data.indexOf(0, languageEnd + 1);
            if (languageEnd >= 0 && translatedEnd >= 0) {
              const content = data.subarray(translatedEnd + 1);
              text = utf8.decode(data[end + 1] === 1 ? unzlibSync(content) : content);
            }
          }
          if (text) entries.push({ keyword, text });
        }
      }
    } catch (error) { metadataError = error; }
    offset += length + 12;
    if (type === "IEND") break;
  }
  const novel = () => isNovelAI(entries);
  // NovelAI stealth metadata uses column-major alpha LSBs in 8-bit RGBA PNGs.
  // A surviving Software/Source marker or incomplete Comment must not hide the alpha recipe.
  if ((!hasPrompt(entries) || !hasParameters(entries)) && idat.length && bytes[24] === 8 && bytes[25] === 6 && bytes[28] === 0 && width * height <= 16777216) {
    try {
      const stride = width * 4;
      const expected = (stride + 1) * height;
      // One extra byte detects oversized streams without allocating their claimed expansion.
      const raw = unzlibSync(join(idat), { out: new Uint8Array(expected + 1) });
      if (raw.length !== expected) throw new Error("Invalid PNG pixel data");
      // Unfilter in place to avoid a second full RGBA allocation on memory-limited phones.
      for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        if (filter > 4) throw new Error("Invalid PNG filter");
        for (let x = 0; x < stride; x++) {
          const index = y * (stride + 1) + 1 + x;
          const a = x >= 4 ? raw[index - 4] : 0;
          const b = y ? raw[index - stride - 1] : 0;
          const c = y && x >= 4 ? raw[index - stride - 5] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
          raw[index] += predictor;
        }
      }
      let bit = 0;
      const read = () => {
        let byte = 0;
        for (let i = 0; i < 8; i++, bit++) {
          if (bit >= width * height) throw new Error("Truncated stealth metadata");
          byte = (byte << 1) | (raw[(bit % height) * (stride + 1) + Math.floor(bit / height) * 4 + 4] & 1);
        }
        return byte;
      };
      if (width * height >= 152) {
        const signature = utf8.decode(Uint8Array.from({ length: 15 }, read));
        if (["stealth_pngcomp", "stealth_pnginfo"].includes(signature)) {
          const lengthBytes = Uint8Array.from({ length: 4 }, read);
          const lengthBits = new DataView(lengthBytes.buffer).getUint32(0);
          if (lengthBits % 8 || lengthBits > width * height - bit) throw new Error("Invalid stealth metadata length");
          const payload = Uint8Array.from({ length: lengthBits / 8 }, read);
          const info = JSON.parse(utf8.decode(signature.endsWith("comp") ? gunzipSync(payload) : payload));
          for (const [keyword, value] of Object.entries(info)) {
            // Prefer explicit file metadata, but fill missing fields from the hidden copy.
            const existing = entries.find(entry => entry.keyword === keyword);
            const text = typeof value === "string" ? value : JSON.stringify(value);
            if (!existing) entries.push({ keyword, text });
            else if (keyword === "Comment") {
              try { existing.text = JSON.stringify({ ...JSON.parse(text), ...JSON.parse(existing.text) }); }
              catch { existing.text = text; }
            }
          }
        }
      }
    } catch (error) { metadataError = error; }
  }
  if (metadataError && !(novel() && (hasPrompt(entries) || hasParameters(entries)))) throw metadataError;
  return { type: novel() ? "NOVELAI" : "UNKNOWN", entries };
}
