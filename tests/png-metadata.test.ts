import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, zlibSync } from "fflate";
import { generationPngMetadata, preserveCanvasMetadata, writePngMetadata, pngSize } from "../lib/nai/png-metadata";
import { extractImageMetadata, parseImage } from "../lib/nai/media";
import { importNovelAIRecipe, recipeFromNovelAIMetadata, recipeReproductionMessage } from "../lib/nai/import-recipe";
import { buildPayload } from "../lib/nai/payload";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { Image as NaiImage, Model, EventType, base64ToBytes } from "../lib/nai/protocol";
import { NaiClient } from "../lib/nai/client";

const utf = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const u32 = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
const chunk = (type: string, bytes: Uint8Array) => concat(u32(bytes.length), utf(type), bytes, u32(0));
function png(width = 64, height = 64) {
  const pixels = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * (width * 4 + 1) + x * 4 + 4] = 255;
  return concat(new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR", concat(u32(width), u32(height), new Uint8Array([8,6,0,0,0]))),
    chunk("IDAT", zlibSync(pixels)), chunk("IEND", new Uint8Array()));
}
const url = (bytes: Uint8Array) => new NaiImage(bytes).toDataURL();
const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: "image/png" });
const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({ ...DEFAULT_SETTINGS, width: 64, height: 64, prompt: "修复拼接处", ...patch });
const comment = async (bytes: Uint8Array) => JSON.parse((await extractImageMetadata(blob(bytes))).entries.find(entry => entry.keyword === "Comment")!.text);
const recipePng = () => writePngMetadata(png(128, 64), [
  { keyword: "Software", text: "NovelAI" },
  { keyword: "Comment", text: JSON.stringify({ prompt: "old prompt", uc: "old negative", model: Model.V4_5, width: 128, height: 64, steps: 23, seed: 65 }) },
]);
function chunks(bytes: Uint8Array) {
  const chunks: { type: string; content: Uint8Array; crc: number }[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
    chunks.push({ type: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), content: bytes.subarray(offset + 4, offset + 8 + size), crc: new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + size).getUint32(0) });
    offset += size + 12;
  }
  return chunks;
}

test("PNG writing round-trips Chinese metadata with valid CRCs and byte-identical image chunks", async () => {
  const original = recipePng();
  const written = writePngMetadata(original, [{ keyword: "Comment", text: JSON.stringify({ prompt: "樱花与接缝", steps: 28 }) }]);
  assert.deepEqual(chunks(written).filter(c => c.type === "IDAT"), chunks(original).filter(c => c.type === "IDAT"));
  for (const c of chunks(written).filter(c => c.type === "iTXt")) {
    // Independent bitwise CRC verifier, not the writer's table implementation.
    let crc = 0xffffffff;
    for (const byte of c.content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    assert.equal(c.crc, (crc ^ 0xffffffff) >>> 0);
  }
  const entries = (await extractImageMetadata(blob(written))).entries;
  assert.equal(entries.filter(e => e.keyword === "Comment").length, 1);
  assert.equal((await importNovelAIRecipe(blob(written))).settings.prompt, "樱花与接缝");
  assert.throws(() => writePngMetadata(original.slice(0, -3), []), /IEND|Truncated/);
});

test("a metadata-free imported PNG retains its exact original bytes without canvas re-encoding", async t => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = globals.createImageBitmap;
  globals.createImageBitmap = async () => ({ width: 64, height: 64, close() {} });
  t.after(() => { if (previous === undefined) delete globals.createImageBitmap; else globals.createImageBitmap = previous; });
  for (const bytes of [png(), recipePng()]) assert.deepEqual(base64ToBytes((await parseImage(blob(bytes))).base64), bytes);
});

test("metadata-free sources acquire the new effective img2img/infill recipe without embedded inputs", async () => {
  for (const mode of ["img2img", "infill"] as const) {
    const s = settings({ model: Model.V4_5, seed: 4294967295, qualityToggle: true, ucPreset: 0, negativePrompt: "bad seams",
      characters: [{ prompt: "girl", uc: "hat", enabled: true, center: { x: 0.2, y: 0.3 } }],
      imageSource: { mode, width: 64, height: 64, dataUrl: url(png()), mask: url(png()), strength: 0.4, noise: 0.2, inpaintStrength: 0.6 } });
    const payload = buildPayload(s, s.seed);
    payload.parameters.token = "secret"; payload.parameters.unknown_field = "untrusted";
    const bytes = await generationPngMetadata(png(), payload, 1);
    const meta = await comment(bytes), recipe = await importNovelAIRecipe(blob(bytes));
    assert.equal(meta.action, mode); assert.equal(meta.seed, 0);
    assert.equal(meta.strength, 0.4); assert.equal(meta.noise, 0.2);
    assert.equal(meta.image, undefined); assert.equal(meta.mask, undefined); assert.equal(meta.token, undefined);
    assert.equal(meta.unknown_field, undefined);
    assert.equal(recipe.settings.model, Model.V4_5); assert.equal(recipe.settings.seed, 0);
    assert.equal(recipe.settings.characters[0].prompt, "girl");
    assert.deepEqual(recipe.reproductionWarnings, [mode]); assert.equal(recipe.settings.imageSource, null);
    const rebuilt = buildPayload(recipe.settings, recipe.settings.seed);
    assert.equal(rebuilt.input, payload.input); assert.equal(rebuilt.parameters.negative_prompt, payload.parameters.negative_prompt);
    assert.equal(recipe.imageSettings?.strength, 0.4);
  }
});

test("canvas crop/save/export retains the source recipe and seed, updates size, and marks edits", async () => {
  const output = base64ToBytes(await preserveCanvasMetadata(url(png(64, 64)), url(recipePng())));
  const recipe = await importNovelAIRecipe(blob(output)), meta = await comment(output);
  assert.equal(recipe.settings.prompt, "old prompt"); assert.equal(recipe.settings.seed, 65);
  assert.deepEqual([recipe.settings.width, recipe.settings.height], [64, 64]);
  assert.deepEqual([meta.sakura_original_width, meta.sakura_original_height], [128, 64]);
  assert.deepEqual(recipe.reproductionWarnings, ["edited"]);
  assert.match(recipeReproductionMessage(recipe)!, /cropped or edited/);
  assert.deepEqual(chunks(output).filter(c => c.type === "IDAT"), chunks(png()).filter(c => c.type === "IDAT"));
  assert.equal(await preserveCanvasMetadata(url(png()), url(png())), url(png()));
  assert.equal(await preserveCanvasMetadata(url(png()), null), url(png()));
  const unchanged = base64ToBytes(await preserveCanvasMetadata(url(png(128,64)), url(recipePng()), false));
  assert.deepEqual((await importNovelAIRecipe(blob(unchanged))).reproductionWarnings, []);
});

test("alpha-only stealth generation data survives canvas crop in standard PNG chunks", async () => {
  const width = 128, height = 64;
  const data = gzipSync(utf(JSON.stringify({ Software: "NovelAI", Comment: JSON.stringify({ prompt: "stealth source", steps: 24, seed: 8 }) })));
  const payload = concat(utf("stealth_pngcomp"), u32(data.length * 8), data);
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let bit = 0; bit < width * height; bit++) {
    const value = bit < payload.length * 8 ? (payload[Math.floor(bit / 8)] >> (7 - bit % 8)) & 1 : 1;
    raw[(bit % height) * (width * 4 + 1) + Math.floor(bit / height) * 4 + 4] = 254 | value;
  }
  const source = concat(png(width,height).subarray(0,33), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array()));
  const result = base64ToBytes(await preserveCanvasMetadata(url(png()), url(source)));
  const recipe = await importNovelAIRecipe(blob(result));
  assert.equal(recipe.settings.prompt, "stealth source"); assert.equal(recipe.settings.seed, 8);
  assert.deepEqual(recipe.reproductionWarnings, ["edited"]);
});

test("official request names and inpainting model suffixes are recognized with no fake inputs", () => {
  for (const requestType of ["NativeInfillingRequest", "Img2ImgRequest"]) {
    const r = recipeFromNovelAIMetadata([{ keyword: "Comment", text: JSON.stringify({ prompt: "cat", request_type: requestType, steps: 28 }) }], { width: 64, height: 64 });
    assert.match(recipeReproductionMessage(r)!, /original base image/);
  }
});

function mockCanvas(t: TestContext) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { document: globals.document, Image: globals.Image };
  globals.Image = class {
    src = "";
    get naturalWidth() { return pngSize(base64ToBytes(this.src))!.width; }
    get naturalHeight() { return pngSize(base64ToBytes(this.src))!.height; }
    async decode() {}
  };
  globals.document = { createElement: () => {
    const c = { width: 0, height: 0, toDataURL: () => url(png(c.width, c.height)), getContext: () => ({
      drawImage() {}, putImageData() {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    }) };
    return c;
  } };
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete globals[key]; else globals[key] = value; } });
}

test("client saves current infill/focused request metadata after canvas composition, replacing old source parameters", async t => {
  mockCanvas(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.action, "infill");
    const size = request.parameters;
    return Response.json({ images: [{ index: 0, image: url(png(size.width, size.height)).split(",")[1] }] });
  });
  const client = new NaiClient({ host: "https://example.invalid", token: "fake-token", maxRetries: 0, baseDelay: 0 });
  for (const focused of [false, true]) {
    const s = settings({ model: Model.V4_5, width: focused ? 128 : 64, height: focused ? 128 : 64, seed: 11, steps: 31,
      imageSource: { dataUrl: url(recipePng()), width: 128, height: 64, mask: url(png(128,64)), mode: "infill", strength: 0.7, noise: 0, inpaintStrength: 0.8, focused } });
    const handle = await client.generate(s, false);
    const events = []; for await (const event of handle.events) events.push(event);
    assert.equal(events[0].event_type, EventType.FINAL);
    const meta = await comment(events[0].image.data), r = await importNovelAIRecipe(blob(events[0].image.data));
    assert.equal(meta.steps, 31); assert.equal(meta.seed, 11); assert.match(meta.prompt, /修复拼接处/);
    assert.equal(meta.inpaintImg2ImgStrength, 0.8); assert.equal(meta.action, "infill");
    assert.deepEqual([meta.width, meta.height], focused ? [128, 64] : [64, 64]);
    assert.equal(meta.request_width, s.width); assert.equal(meta.request_height, s.height);
    assert.equal(meta.focused, focused ? true : undefined); assert.deepEqual(r.reproductionWarnings, ["infill"]);
  }
  assert.equal(calls, 2);
});

test("final-only img2img batches and direct enhancement save metadata for every returned PNG", async t => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = globals.createImageBitmap;
  globals.createImageBitmap = async () => ({ width: 64, height: 64, close() {} });
  t.after(() => { if (previous === undefined) delete globals.createImageBitmap; else globals.createImageBitmap = previous; });
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.action, "img2img");
    return Response.json({ images: Array.from({ length: request.parameters.n_samples }, (_, index) => ({ index, image: url(png()).split(",")[1] })) });
  });
  const client = new NaiClient({ host: "https://example.invalid", token: "fake-token", maxRetries: 0, baseDelay: 0 });
  const s = settings({ seed: 19, nSamples: 2, imageSource: { dataUrl: url(png()), width: 64, height: 64, mode: "img2img", strength: 0.5, noise: 0.1, inpaintStrength: 1 } });
  const handle = await client.generate(s, false);
  let count = 0;
  for await (const event of handle.events) {
    const meta = await comment(event.image.data);
    assert.equal(meta.seed, 19 + event.samp_ix); assert.equal(meta.action, "img2img");
    assert.equal(meta.strength, 0.5); assert.equal(meta.noise, 0.1); count++;
  }
  assert.equal(count, 2);
  const enhanced = await client.enhance(blob(png()), s);
  const metadata = await comment(enhanced[0].data);
  assert.equal(metadata.action, "img2img"); assert.equal(metadata.strength, 0.2); assert.equal(metadata.seed, 19);
});
