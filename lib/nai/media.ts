import { gunzipSync, unzlibSync } from "fflate";
import { base64ToBytes } from "./protocol";

export async function parseImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to decode image");
    ctx.drawImage(bitmap, 0, 0);
    return { base64: canvas.toDataURL("image/png").split(",")[1], width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

/** Fit character references into the service's supported canvas, without cropping. */
export async function prepareDirectorReference(base64: string) {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(base64ToBytes(base64))]));
  try {
    const ratio = bitmap.width / bitmap.height;
    const [width, height] = ratio > 1.2 ? [1536, 1024] : ratio < 0.8 ? [1024, 1536] : [1472, 1472];
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to prepare reference image");
    ctx.fillStyle = "black"; ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally { bitmap.close(); }
}

type Entry = { keyword: string; text: string };
const utf8 = new TextDecoder();
const latin1 = new TextDecoder("latin1");
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

/** Decode PNG chunks without canvas, which would discard metadata and alter alpha LSBs. */
export async function extractImageMetadata(blob: Blob): Promise<{ type: string; entries: Entry[] }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v))
    return { type: "UNKNOWN", entries: [] };
  const view = new DataView(bytes.buffer), entries: Entry[] = [], idat: Uint8Array[] = [];
  const width = view.getUint32(16), height = view.getUint32(20);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const type = utf8.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idat.push(data);
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
    offset += length + 12;
    if (type === "IEND") break;
  }
  const novel = () => entries.some(e => /novelai/i.test(e.text) || e.keyword === "Comment" && /"(?:steps|v4_prompt|sampler)"/.test(e.text));
  // NovelAI stealth metadata uses column-major alpha LSBs in 8-bit RGBA PNGs.
  if (!novel() && bytes[24] === 8 && bytes[25] === 6 && bytes[28] === 0 && width * height <= 16777216) {
    const stride = width * 4;
    const raw = unzlibSync(join(idat));
    if (raw.length !== (stride + 1) * height) throw new Error("Invalid PNG pixel data");
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      if (filter > 4) throw new Error("Invalid PNG filter");
      for (let x = 0; x < stride; x++) {
        const index = y * stride + x;
        const a = x >= 4 ? pixels[index - 4] : 0;
        const b = y ? pixels[index - stride] : 0;
        const c = y && x >= 4 ? pixels[index - stride - 4] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
        pixels[index] = raw[y * (stride + 1) + 1 + x] + predictor;
      }
    }
    let bit = 0;
    const read = () => {
      let byte = 0;
      for (let i = 0; i < 8; i++, bit++) {
        if (bit >= width * height) throw new Error("Truncated stealth metadata");
        byte = (byte << 1) | (pixels[((bit % height) * width + Math.floor(bit / height)) * 4 + 3] & 1);
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
        for (const [keyword, value] of Object.entries(info)) entries.push({ keyword, text: typeof value === "string" ? value : JSON.stringify(value) });
      }
    }
  }
  return { type: novel() ? "NOVELAI" : "UNKNOWN", entries };
}
