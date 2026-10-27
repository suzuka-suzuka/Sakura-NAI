import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, zlibSync } from "fflate";
import { toast } from "sonner";
import { extractImageMetadata, parseImage, prepareDirectorReference } from "../lib/nai/media";
import { readExifMetadata } from "../lib/nai/exif-metadata";
import { readImageDimensions } from "../lib/nai/image-decode";
import { importNovelAIRecipe } from "../lib/nai/import-recipe";
import { prepareImageImport, applyImageImport } from "../lib/recipe-import";
import { pickImageFile, isImageFile } from "../lib/image-picker";
import { useStore } from "../lib/store";
import { base64ToBytes } from "../lib/nai/protocol";

const utf = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const u32 = (n: number, little = false) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, little); return b; };
const chunk = (type: string, data: Uint8Array) => concat(u32(data.length), utf(type), data, u32(0));
const info = { prompt: "樱花下的女孩", uc: "blurry", steps: 23, seed: 42, reference_strength_multiple: [0.6] };
function png(extra: Uint8Array[] = [], hidden?: object, filter = 0) {
  const width = 64, height = 64, raw = new Uint8Array(height * (width * 4 + 1));
  const payload = hidden ? gzipSync(utf(JSON.stringify({ Software: "NovelAI", Comment: JSON.stringify(hidden) }))) : new Uint8Array();
  const bits = concat(utf("stealth_pngcomp"), u32(payload.length * 8), payload);
  for (let bit = 0; bit < width * height; bit++) {
    const value = hidden && bit < bits.length * 8 ? bits[bit >> 3] >> (7 - bit % 8) & 1 : 1;
    raw[(bit % height) * (width * 4 + 1) + Math.floor(bit / height) * 4 + 4] = 254 | value;
  }
  const encoded = raw.slice(), stride = width * 4 + 1;
  for (let y = 0; y < height; y++) {
    encoded[y * stride] = filter;
    for (let x = 0; x < width * 4; x++) {
      const at = y * stride + x + 1, left = x >= 4 ? raw[at - 4] : 0;
      const above = y ? raw[at - stride] : 0, corner = y && x >= 4 ? raw[at - stride - 4] : 0;
      const distances = [left, above, corner].map(value => Math.abs(left + above - corner - value));
      const paeth = [left, above, corner][distances.indexOf(Math.min(...distances))];
      encoded[at] -= [0, left, above, Math.floor((left + above) / 2), paeth][filter];
    }
  }
  return concat(new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR", concat(u32(width), u32(height), new Uint8Array([8,6,0,0,0]))),
    ...extra, chunk("IDAT", zlibSync(encoded)), chunk("IEND", new Uint8Array()));
}
function exif(little = true, unicode = false) {
  const source = utf("NovelAI Diffusion V4.5 Full\0");
  let comment = utf(JSON.stringify(info));
  if (unicode) {
    comment = new Uint8Array(Buffer.from(JSON.stringify(info), "utf16le"));
    if (!little) for (let i = 0; i < comment.length; i += 2) [comment[i], comment[i + 1]] = [comment[i + 1], comment[i]];
  }
  const content = concat(utf(unicode ? "UNICODE\0" : "ASCII\0\0\0"), comment);
  const bytes = new Uint8Array(56 + source.length + content.length), view = new DataView(bytes.buffer);
  bytes.set(utf(little ? "II" : "MM"));
  view.setUint16(2, 42, little); view.setUint32(4, 8, little);
  view.setUint16(8, 2, little);
  const tag = (at: number, name: number, type: number, size: number, offset: number) => {
    view.setUint16(at, name, little); view.setUint16(at + 2, type, little);
    view.setUint32(at + 4, size, little); view.setUint32(at + 8, offset, little);
  };
  tag(10, 0x131, 2, source.length, 56); tag(22, 0x8769, 4, 1, 38);
  view.setUint16(38, 1, little); tag(40, 0x9286, 7, content.length, 56 + source.length);
  bytes.set(source, 56); bytes.set(content, 56 + source.length);
  return bytes;
}
function container(type: "webp" | "jpeg" | "png", data: Uint8Array) {
  if (type === "png") return png([chunk("eXIf", data)]);
  if (type === "jpeg") {
    const payload = new TextDecoder().decode(data.subarray(0, 6)) === "Exif\0\0" ? data : concat(utf("Exif\0\0"), data), size = payload.length + 2;
    return concat(new Uint8Array([0xff,0xd8,0xff,0xe1,size >> 8,size & 255]), payload, new Uint8Array([0xff,0xd9]));
  }
  // An odd-sized unknown RIFF chunk checks word alignment before EXIF.
  const chunks = concat(utf("JUNK"), u32(1, true), new Uint8Array([7,0]), utf("EXIF"), u32(data.length, true), data,
    data.length % 2 ? new Uint8Array([0]) : new Uint8Array());
  return concat(utf("RIFF"), u32(chunks.length + 4, true), utf("WEBP"), chunks);
}
const replacedGlobals = new WeakMap<TestContext, Set<string>>();
function global(t: TestContext, name: string, value: unknown) {
  const names = replacedGlobals.get(t) ?? new Set<string>();
  replacedGlobals.set(t, names);
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  if (names.has(name)) return;
  names.add(name);
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
}
function browser(t: TestContext) {
  global(t, "createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, fillStyle: "" }), toDataURL: () => "data:image/png;base64,normalized" };
  global(t, "document", { createElement: () => canvas });
  t.mock.method(toast, "dismiss", () => 0);
  return canvas;
}
beforeEach(() => useStore.setState(useStore.getInitialState(), true));

test("WebP/JPEG/PNG EXIF restores parameters across TIFF byte orders, prefixes and Chinese encodings", async t => {
  browser(t);
  for (const type of ["webp", "jpeg", "png"] as const) for (const little of [true, false]) for (const unicode of [true, false]) {
    const data = exif(little, unicode);
    for (const prefix of [false, true]) {
      const file = new File([container(type, prefix ? concat(utf("Exif\0\0"), data) : data)], `image.${type}`, { type: "application/octet-stream" });
      const recipe = await importNovelAIRecipe(file);
      assert.equal(recipe.settings.prompt, info.prompt); assert.equal(recipe.settings.seed, 42);
      assert.equal(recipe.settings.negativePrompt, "blurry"); assert.equal(recipe.settings.steps, 23);
      assert.equal(recipe.settings.model, "nai-diffusion-4-5-full");
      assert.deepEqual([recipe.settings.width, recipe.settings.height], [64, 64]);
      assert.equal(recipe.omittedReferences, true);
    }
  }
});

test("a mislabeled WebP imports from original EXIF before canvas conversion", async t => {
  browser(t);
  const file = new File([container("webp", exif())], "343.png", { type: "image/png" });
  assert.equal(await prepareImageImport(file), true);
  assert.equal(useStore.getState().imageImport?.recipe?.settings.prompt, info.prompt);
  assert.equal(applyImageImport("recipe"), true);
  assert.equal(useStore.getState().settings.seed, -1);
});

test("a Software marker, partial Comment, or damaged optional chunk cannot hide valid stealth parameters", async () => {
  for (const [extras, steps] of [
    [[chunk("tEXt", utf("Software\0NovelAI"))], 23],
    [[chunk("tEXt", utf('Comment\0{"steps":31,"reference_strength_multiple":[0.6]}'))], 31],
    [[chunk("zTXt", utf("Comment\0\0broken zlib"))], 23],
    [[chunk("tEXt", utf(`Description\0${info.prompt}`)), chunk("tEXt", utf("Software\0NovelAI"))], 23],
  ] as const) {
    const file = new Blob([png([...extras], info)]);
    const recipe = await importNovelAIRecipe(file);
    assert.equal(recipe.settings.prompt, info.prompt); assert.equal(recipe.settings.seed, 42);
    assert.equal(recipe.settings.steps, steps);
  }
});

test("hidden parameters survive every PNG row filter when decoded in place", async () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const recipe = await importNovelAIRecipe(new Blob([png([], info, filter)]));
    assert.equal(recipe.settings.prompt, info.prompt); assert.equal(recipe.settings.seed, 42);
  }
});

test("one damaged PNG text chunk does not discard a separate valid recipe", async () => {
  const file = new Blob([png([chunk("zTXt", utf("unused\0\0broken")), chunk("tEXt", utf(`Comment\0${JSON.stringify(info)}`))])]);
  assert.equal((await importNovelAIRecipe(file)).settings.prompt, info.prompt);
  await assert.rejects(extractImageMetadata(new Blob([png([chunk("zTXt", utf("Comment\0\0broken"))])])));
});

test("invalid EXIF offsets and truncated containers fail without allocating from untrusted lengths", async () => {
  const bad = exif(); new DataView(bad.buffer).setUint32(48, 0xfffffff0, true);
  assert.throws(() => readExifMetadata(bad), /Truncated/);
  const cyclic = exif(); new DataView(cyclic.buffer).setUint32(30, 8, true);
  assert.equal(readExifMetadata(cyclic).length, 1);
  for (const type of ["webp", "jpeg"] as const)
    await assert.rejects(extractImageMetadata(new Blob([container(type, exif()).slice(0, -5)])), /Truncated/);
  assert.equal((await extractImageMetadata(new Blob([new Uint8Array([0xff])]))).entries.length, 0);
});

test("iOS image element fallback handles missing and rejecting ImageBitmap while preserving PNG bytes", async t => {
  browser(t);
  const revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => "blob:local-test");
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  global(t, "Image", class {
    naturalWidth = 64; naturalHeight = 64; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  for (const bitmap of [undefined, async () => { throw new Error("Unsupported image type"); }]) {
    global(t, "createImageBitmap", bitmap);
    const bytes = png([], info);
    const parsed = await parseImage(new Blob([bytes]));
    assert.deepEqual(base64ToBytes(parsed.base64), bytes);
    assert.deepEqual(await readImageDimensions(new Blob([container("jpeg", exif())])), { width: 64, height: 64 });
    await prepareDirectorReference(parsed.base64);
  }
  assert.equal(revoked.length, 6);
});

test("failed native decoding revokes its URL; exhausted canvas memory never produces an empty base image", async t => {
  const canvas = browser(t);
  canvas.toDataURL = () => "data:,";
  await assert.rejects(parseImage(new Blob([container("jpeg", exif())])), /too large/);
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  global(t, "createImageBitmap", undefined);
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  global(t, "Image", class { onerror?: () => void; set src(_v: string) { queueMicrotask(() => this.onerror?.()); } });
  await assert.rejects(parseImage(new Blob([png()])), /could not be read/);
  assert.equal(revoke.mock.calls.length, 1);
});

test("the screenshot's reference notice does not prevent import or cover success with a warning", async t => {
  browser(t);
  const warning = t.mock.method(toast, "warning", () => 0);
  useStore.setState({ negativePromptActive: true, combinedPrompts: true, galleryOpen: true, settingsCollapsed: true });
  const file = new File([png([chunk("tEXt", utf(`Comment\0${JSON.stringify(info)}`))])], "343.png");
  assert.equal(await prepareImageImport(file), true);
  assert.equal(useStore.getState().imageImport?.recipe?.omittedReferences, true);
  assert.equal(applyImageImport("recipe"), true);
  const state = useStore.getState();
  assert.equal(state.settings.prompt, info.prompt); assert.equal(state.settings.seed, -1);
  assert.equal(state.negativePromptActive, false); assert.equal(state.settingsCollapsed, false);
  assert.equal(state.galleryOpen, false); assert.equal(warning.mock.calls.length, 0);
});

test("iPhone/iPad original-file pickers stay attached until change/cancel and accept byte-preserving Files input", t => {
  const inputs: (EventTarget & { type: string; accept: string; files: File[]; style: { cssText: string }; remove: () => void; click: () => void; setAttribute: () => void })[] = [];
  const attached = new Set<unknown>();
  global(t, "document", {
    body: { appendChild: (input: unknown) => attached.add(input) },
    createElement: () => {
      const input = Object.assign(new EventTarget(), { type: "", accept: "", files: [] as File[], style: { cssText: "" },
        remove: () => { attached.delete(input); }, click: () => { assert.equal(attached.has(input), true); }, setAttribute() {} });
      inputs.push(input); return input;
    },
  });
  for (const nav of [{ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }, { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }]) {
    global(t, "navigator", nav);
    let selected: File | undefined;
    pickImageFile(file => { selected = file; }, true);
    const input = inputs.at(-1)!;
    assert.equal(input.accept, "application/octet-stream");
    input.files = [new File([png()], "original.png", { type: "" })];
    input.dispatchEvent(new Event("change"));
    assert.equal(selected, input.files[0]); assert.equal(attached.size, 0);
    assert.equal(isImageFile(selected!), true);
    pickImageFile(() => assert.fail("Cancel must not import"));
    assert.match(inputs.at(-1)!.accept, /image\/png,image\/webp/);
    inputs.at(-1)!.dispatchEvent(new Event("cancel"));
    assert.equal(attached.size, 0);
  }
});
