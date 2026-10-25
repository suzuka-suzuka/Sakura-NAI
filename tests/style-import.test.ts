import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { encode } from "@msgpack/msgpack";
import { toast } from "sonner";
import { Model, bytesToBase64 } from "../lib/nai/protocol";
import { DEFAULT_SETTINGS, type GenerationSettings, type ReferenceImage } from "../lib/nai/types";
import { V5_FULL } from "../lib/nai/models";
import { parseVibeFile, exportVibes, vibeEncoding, compatibleVibeModel, embeddedVibes } from "../lib/nai/vibes";
import { NaiClient } from "../lib/nai/client";
import { buildPayload } from "../lib/nai/payload";
import { createStylePreset, parseStylePresets, exportStylePresets, applyStylePreset } from "../lib/style-presets";
import { loadReferenceSession, saveReferenceSession, loadStyleLibrary, saveStyleLibrary } from "../lib/db/style-library";
import { generationPngMetadata, preserveCanvasMetadata } from "../lib/nai/png-metadata";
import { extractImageMetadata } from "../lib/nai/media";
import { recipeFromNovelAIMetadata } from "../lib/nai/import-recipe";
import { selectedRecipeSettings, prepareImageImport, DEFAULT_RECIPE_IMPORT } from "../lib/recipe-import";
import { prepareStyleImport } from "../lib/style-import";
import { useStore } from "../lib/store";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSFkAAAAASUVORK5CYII=";
const image = { base64: png, preview: `data:image/png;base64,${png}` };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({ ...DEFAULT_SETTINGS, prompt: "current subject", model: V5_FULL, ...patch });
function official(type = "image", modelKey = "v4-5full", model = Model.V4_5, ie = 0.88) {
  return { identifier: "novelai-vibe-transfer", version: 1, type, id: hash(type === "image" ? png : "AQID"),
    ...(type === "image" ? { image: png, thumbnail: image.preview } : {}), name: "蜡笔画风", createdAt: new Date().toISOString(),
    encodings: { [modelKey]: { [type === "image" ? hash(`information_extracted:${ie}`) : "unknown"]: { encoding: "AQID", ...(type === "image" ? { params: { information_extracted: ie } } : {}) } }, },
    importInfo: { model, information_extracted: ie, strength: 0.6 } };
}
const refs = () => parseVibeFile(JSON.stringify(official("encoding")));
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  useStore.setState(useStore.getInitialState(), true);
});

test("official image Vibes retain all model variants, exact IE, zero strengths and thumbnails", () => {
  const source = official();
  source.importInfo.strength = 0;
  const variant = { encoding: "BAUG", params: { information_extracted: 0 } };
  source.encodings["v4-5full"][hash("information_extracted:0")] = variant;
  const [ref] = parseVibeFile(JSON.stringify(source));
  assert.equal(ref.name, "蜡笔画风"); assert.equal(ref.base64, png); assert.equal(ref.preview, image.preview);
  assert.equal(ref.strength, 0); assert.equal(ref.informationExtracted, 0.88);
  assert.equal(ref.encodings?.length, 2); assert.equal(vibeEncoding(ref, Model.V4_5)?.data, "AQID");
  assert.equal(vibeEncoding({ ...ref, informationExtracted: 0 }, Model.V4_5)?.data, "BAUG");
});

test("official encoding-only bundles use importInfo when unknown variants have no params", () => {
  const source = { identifier: "novelai-vibe-transfer-bundle", version: 1, vibes: [official("encoding"), official("encoding", "v4full", Model.V4, 0.7)] };
  const parsed = parseVibeFile(JSON.stringify(source), "example.naiv4vibebundle");
  assert.equal(parsed.length, 2); assert.equal(parsed[0].base64, ""); assert.equal(parsed[0].preview, "");
  assert.equal(parsed[0].informationExtracted, 0.88); assert.equal(parsed[1].sourceModel, Model.V4);
  assert.throws(() => compatibleVibeModel(parsed, V5_FULL), /compatible model/);
  assert.equal(compatibleVibeModel([parsed[1]], V5_FULL), Model.V4);
});

test("Vibe exports use the official SHA256 IDs and encoding keys, and round-trip", async () => {
  const imageRef: ReferenceImage = { ...image, name: "test", strength: 0, informationExtracted: 0.88,
    encodings: [{ model: Model.V4_5, informationExtracted: 0.88, data: "AQID" }] };
  const exported = await exportVibes([imageRef], Model.V4_5);
  const source = JSON.parse(exported.text);
  assert.equal(source.id, hash(png));
  assert.equal(source.encodings["v4-5full"]["70ec37e3ec6ec54abb11a1956e86992c45a61bc76dd2d1723fbe3d1ecac6c52c"].encoding, "AQID");
  assert.equal(parseVibeFile(exported.text)[0].strength, 0);
  const bundle = await exportVibes([...refs(), ...refs()], V5_FULL);
  assert.equal(bundle.extension, ".naiv4vibeBundle");
  const file = JSON.parse(bundle.text).vibes[0];
  assert.equal(file.type, "encoding"); assert.equal(file.id, hash("AQID")); assert.equal(file.encodings["v4-5full"].unknown.encoding, "AQID");
  assert.equal(parseVibeFile(bundle.text).length, 2);
});

test("invalid Vibes reject unsupported versions, corrupt encodings, external images and excessive counts", () => {
  assert.throws(() => parseVibeFile("not JSON"), /JSON/);
  assert.throws(() => parseVibeFile(JSON.stringify({ ...official(), version: 2 })), /supported/);
  assert.throws(() => parseVibeFile(JSON.stringify({ ...official(), image: "https://example.com/image.png" })), /reference image/);
  const invalid = official("encoding"); invalid.encodings["v4-5full"].unknown.encoding = "!invalid!";
  assert.throws(() => parseVibeFile(JSON.stringify(invalid)), /encoding/);
  assert.throws(() => parseVibeFile(JSON.stringify({ identifier: "novelai-vibe-transfer-bundle", version: 1, vibes: Array.from({ length: 17 }, () => official()) })), /16/);
});

test("imported encodings are sent directly with zero encode-vibe requests; mismatches stop before charging", async t => {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    requests.push({ path, body: JSON.parse(String(init.body)) });
    const bytes = encode({ event_type: "final", samp_ix: 0, step_ix: 28, image: new Uint8Array([137,80,78,71,13,10,26,10]) });
    const frame = new Uint8Array(bytes.length + 4); new DataView(frame.buffer).setUint32(0, bytes.length); frame.set(bytes, 4);
    return new Response(frame, { headers: { "content-type": "application/x-msgpack" } });
  });
  const client = new NaiClient({ host: "https://example.invalid", token: "test-token", maxRetries: 0, baseDelay: 0 });
  const s = settings({ model: Model.V4_5, vibe: refs() });
  assert.equal(client.uncachedVibes(s), 0);
  for await (const _ of (await client.generate(s)).events) { /* exhaust stream */ }
  assert.equal(requests.length, 1); assert.match(requests[0].path, /generate-image/);
  assert.deepEqual((requests[0].body.parameters as Record<string, unknown>).reference_image_multiple, ["AQID"]);
  const mismatch = await client.generate({ ...s, model: Model.V4 });
  await assert.rejects(mismatch.events.next(), /no encoding/);
  assert.equal(requests.length, 1);
});

test("official naidata PNGs restore encoded Vibes independently of prompt and sampling selections", async () => {
  const envelope = { identifier: "novelai-vibe-transfer-bundle", version: 1, vibes: [official("encoding")] };
  const entries = [{ keyword: "Comment", text: JSON.stringify({ model: Model.V4_5, prompt: "saved subject", steps: 28 }) },
    { keyword: "naidata", text: bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope))) }];
  const recipe = recipeFromNovelAIMetadata(entries, { width: 832, height: 1216 });
  assert.equal(recipe.settings.vibe.length, 1); assert.equal(recipe.omittedReferences, false);
  const applied = selectedRecipeSettings(settings(), recipe, { ...DEFAULT_RECIPE_IMPORT, prompt: false, negativePrompt: false, characters: false, settings: false, seed: false, vibes: true });
  assert.equal(applied.prompt, "current subject"); assert.equal(applied.model, Model.V4_5); assert.equal(applied.vibe[0].encodings?.[0].data, "AQID");
  const skipped = selectedRecipeSettings(settings({ vibe: refs() }), recipe, { ...DEFAULT_RECIPE_IMPORT, vibes: false });
  assert.equal(skipped.vibe.length, 1);
  const clean = selectedRecipeSettings(settings({ vibe: refs() }), recipe, { ...DEFAULT_RECIPE_IMPORT, append: true, clean: true });
  assert.equal(clean.vibe.length, 1);
});

test("applying Vibes refuses inpainting and too many active characters without changing the current draft", () => {
  const preset = createStylePreset("参考", "vibe", settings({ vibe: refs() }));
  const inpainting = settings({ imageSource: { dataUrl: image.preview, width: 64, height: 64, mode: "infill", strength: 1, noise: 0, inpaintStrength: 1 } });
  assert.throws(() => applyStylePreset(inpainting, preset), /inpainting/);
  assert.equal(inpainting.model, V5_FULL); assert.deepEqual(inpainting.vibe, []);
  const crowded = settings({ characters: Array.from({ length: 7 }, () => ({ prompt: "girl", uc: "", enabled: true, center: { x: 0.5, y: 0.5 } })) });
  assert.throws(() => applyStylePreset(crowded, preset), /6 active characters/);
  assert.equal(crowded.characters.length, 7); assert.equal(crowded.model, V5_FULL);
});

test("generated and edited PNGs keep reusable encodings without original images; stale Vibes are removed", async () => {
  const source = new Uint8Array(Buffer.from(png, "base64"));
  const payload = buildPayload(settings({ model: Model.V4_5 }), 42);
  Object.assign(payload.parameters, { reference_image_multiple: ["AQID"], reference_strength_multiple: [0.6], reference_information_extracted_multiple: [0.88] });
  const generated = await generationPngMetadata(source, payload, 0);
  const entries = (await extractImageMetadata(new Blob([new Uint8Array(generated)]))).entries;
  assert.equal(embeddedVibes(entries)[0].encodings?.[0].data, "AQID");
  assert.equal(embeddedVibes(entries)[0].base64, "");
  const editedUrl = await preserveCanvasMetadata(`data:image/png;base64,${png}`, `data:image/png;base64,${bytesToBase64(generated)}`);
  const edited = await extractImageMetadata(new Blob([new Uint8Array(Buffer.from(editedUrl.split(",")[1], "base64"))]));
  assert.equal(embeddedVibes(edited.entries).length, 1);
  const cleared = await generationPngMetadata(generated, buildPayload(settings({ model: Model.V4_5 }), 7), 0);
  assert.equal((await extractImageMetadata(new Blob([new Uint8Array(cleared)]))).entries.some(entry => entry.keyword === "naidata"), false);
});

test("prompt and full generation presets round-trip known fields, strip secrets, and apply with Undo-compatible snapshots", () => {
  const s = settings({ prompt: "artist:example", negativePrompt: "bad quality", seed: 123, steps: 23 });
  const prompt = createStylePreset("画师串", "prompt", s);
  const full = createStylePreset("参数", "settings", s);
  const withSecret = { ...full, token: "secret-token" };
  const serialized = exportStylePresets([withSecret, prompt]);
  assert.equal(serialized.includes("secret-token"), false);
  const imported = parseStylePresets(serialized, "presets.json");
  assert.notEqual(imported[0].id, full.id); assert.equal(imported[1].name, "画师串");
  const appended = applyStylePreset(settings(), prompt, true);
  assert.equal(appended.prompt, "current subject, artist:example"); assert.equal(appended.qualityToggle, DEFAULT_SETTINGS.qualityToggle);
  const replaced = applyStylePreset(settings({ vibe: refs() }), full, true);
  assert.equal(replaced.prompt, "artist:example"); assert.equal(replaced.seed, 123); assert.equal(replaced.steps, 23); assert.deepEqual(replaced.vibe, []);
  assert.equal(parseStylePresets("artist:example, watercolor", "watercolor.txt")[0].kind, "prompt");
  assert.throws(() => parseStylePresets('{"token":"secret"}', "unknown.json"), /Sakura/);
});

test("IndexedDB persists active references and named presets separately from localStorage and gallery data", async () => {
  const vibe = refs(); const preset = createStylePreset("参考组合", "vibe", settings({ vibe }));
  await saveReferenceSession({ vibe, directorReference: [] }); await saveStyleLibrary([preset]);
  assert.deepEqual((await loadReferenceSession())?.vibe, vibe);
  assert.deepEqual(await loadStyleLibrary(), [preset]);
  const applied = applyStylePreset(settings(), preset, false);
  assert.equal(applied.model, Model.V4_5); assert.equal(applied.prompt, "current subject");
});

test("new encodings update saved Vibe setups and survive a new client connection without re-encoding", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });
  let encodings = 0;
  t.mock.method(globalThis, "fetch", async (path: string) => {
    if (path.endsWith("/user/subscription")) return Response.json({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0 } });
    if (path.endsWith("/ai/encode-vibe")) { encodings++; return new Response(new Uint8Array([1,2,3])); }
    const event = encode({ event_type: "final", samp_ix: 0, step_ix: 28, image: new Uint8Array([137,80,78,71,13,10,26,10]) });
    const frame = new Uint8Array(event.length + 4); new DataView(frame.buffer).setUint32(0, event.length); frame.set(event, 4);
    return new Response(frame, { headers: { "content-type": "application/x-msgpack" } });
  });
  const raw = { ...image, strength: 0.6, informationExtracted: 0.7 };
  const s = settings({ model: Model.V4_5, vibe: [raw] });
  useStore.setState({ settings: s, styleStatus: "ready" });
  await useStore.getState().saveStylePresets([createStylePreset("cached reference", "vibe", s)]);
  const cfg = { host: "https://example.invalid", token: "test-only", maxRetries: 0, baseDelay: 0 };
  assert.equal(await useStore.getState().connect(cfg), true);
  for await (const _ of (await useStore.getState().client!.generate(s)).events) { /* exhaust stream */ }
  await useStore.getState().saveStylePresets([]); // Wait behind the queued encoding write.
  const saved = (await loadStyleLibrary())[0];
  assert.equal(saved.kind, "vibe");
  if (saved.kind !== "vibe") throw new Error("Expected a Vibe preset");
  assert.equal(saved.vibes[0].encodings?.[0].data, "AQID");
  assert.equal(await useStore.getState().connect(cfg), true);
  const restored = applyStylePreset(settings(), saved, false);
  assert.equal(useStore.getState().client!.uncachedVibes(restored), 0);
  for await (const _ of (await useStore.getState().client!.generate(restored)).events) { /* exhaust stream */ }
  assert.equal(encodings, 1);
});

test("file import is reviewable and atomic: failed bundles never overwrite the current prompt or pending import", async t => {
  t.mock.method(toast, "dismiss", () => 0);
  const before = useStore.getState().settings;
  assert.equal(await prepareStyleImport([new File([JSON.stringify(official())], "画风.naiv4vibe")]), true);
  assert.equal(useStore.getState().settings, before);
  const pending = useStore.getState().styleImport;
  assert.equal(pending?.presets[0].kind, "vibe");
  assert.equal(await prepareStyleImport([new File([JSON.stringify(official())], "valid.naiv4vibe"), new File(["broken"], "bad.naiv4vibe")]), false);
  assert.equal(useStore.getState().styleImport, pending); assert.equal(useStore.getState().settings, before);
});

test("the latest file wins across image and style imports and only one import dialog remains open", async t => {
  t.mock.method(toast, "dismiss", () => 0);
  const bitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  t.after(() => { if (bitmap) Object.defineProperty(globalThis, "createImageBitmap", bitmap); else Reflect.deleteProperty(globalThis, "createImageBitmap"); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = new File(["unused"], "slow.naiv4vibe");
  t.mock.method(slow, "text", async () => { await gate; return JSON.stringify(official()); });
  const earlier = prepareStyleImport([slow]);
  const pngFile = new File([new Uint8Array(Buffer.from(png, "base64"))], "latest.png", { type: "image/png" });
  assert.equal(await prepareImageImport(pngFile), true);
  release(); assert.equal(await earlier, false);
  assert.equal(useStore.getState().imageImport?.filename, "latest.png");
  assert.equal(useStore.getState().showStyleLibrary, false); assert.equal(useStore.getState().styleImport, null);
});
