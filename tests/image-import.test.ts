import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { zlibSync } from "fflate";
import { toast } from "sonner";
import { useStore } from "../lib/store";
import { prepareImageImport, applyImageImport, importRecipeFile, DEFAULT_RECIPE_IMPORT } from "../lib/recipe-import";
import { DEFAULT_SETTINGS } from "../lib/nai/types";
import { Model } from "../lib/nai/protocol";
import { V5_FULL, V5_CURATED } from "../lib/nai/models";

const ref = { base64: "existing", preview: "data:image/png;base64,existing", strength: 0.3, informationExtracted: 0.5 };
const utf = (s: string) => new TextEncoder().encode(s);
const u32 = (n: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, n); return bytes; };
const concat = (...arrays: Uint8Array[]) => new Uint8Array(Buffer.concat(arrays));
const chunk = (type: string, bytes: Uint8Array) => concat(u32(bytes.length), utf(type), bytes, u32(0));
function png(comment?: string) {
  const header = concat(new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", concat(u32(64), u32(64), new Uint8Array([8,6,0,0,0]))));
  return new File([concat(header, ...(comment ? [chunk("tEXt", utf(`Comment\0${comment}`))] : []),
    chunk("IDAT", zlibSync(new Uint8Array(64 * (64 * 4 + 1)))), chunk("IEND", new Uint8Array()))], "image.png", { type: "image/png" });
}
const recipeFile = () => png(JSON.stringify({ model: Model.V4_5_CUR, prompt: "saved prompt", uc: "saved negative", steps: 22, seed: 42 }));
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().patchSettings({ ...DEFAULT_SETTINGS, prompt: "current draft", negativePrompt: "current negative", vibe: [], directorReference: [] });
});
function decodeImages(t: TestContext) {
  t.mock.method(toast, "dismiss", (id?: string | number) => id ?? 0);
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { document: globals.document, createImageBitmap: globals.createImageBitmap };
  globals.document = { createElement: () => ({
    width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,decoded",
  }) };
  globals.createImageBitmap = async () => ({ width: 64, height: 64, close() {} });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globals[key]; else globals[key] = value; } });
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Image import must stay local"); });
  return network;
}

test("dropping metadata opens a choice without modifying the draft, preview, or model; cancel keeps them", async t => {
  const network = decodeImages(t);
  const before = useStore.getState().settings;
  assert.equal(await prepareImageImport(recipeFile()), true);
  const s = useStore.getState();
  assert.equal(s.settings, before);
  assert.equal(s.selectedImage, null);
  assert.equal(s.imageImport?.recipe?.settings.prompt, "saved prompt");
  s.setUI({ imageImport: null });
  assert.equal(applyImageImport("recipe"), false);
  assert.equal(useStore.getState().settings, before);
  assert.equal(network.mock.calls.length, 0);
});

test("only selecting parameter import restores embedded settings", async t => {
  decodeImages(t);
  await prepareImageImport(recipeFile());
  assert.equal(applyImageImport("recipe"), true);
  const s = useStore.getState();
  assert.equal(s.settings.prompt, "saved prompt");
  assert.equal(s.settings.negativePrompt, "saved negative");
  assert.equal(s.settings.steps, 22);
  assert.equal(s.settings.seed, 42);
  assert.equal(s.settings.model, Model.V4_5_CUR);
  assert.equal(s.settings.imageSource, null);
  assert.equal(s.imageImport, null);
  assert.equal(s.settingsCollapsed, false);
});

test("an image without metadata cannot import parameters but can become a base", async t => {
  decodeImages(t);
  await prepareImageImport(png());
  assert.equal(useStore.getState().imageImport?.recipe, null);
  const before = useStore.getState().settings;
  assert.equal(applyImageImport("recipe"), false);
  assert.equal(useStore.getState().settings, before);
  assert.equal(applyImageImport("img2img"), true);
  assert.equal(useStore.getState().settings.imageSource?.mode, "img2img");
});

test("a metadata-bearing image used as a base preserves current prompts, model, and sampling settings", async t => {
  decodeImages(t);
  useStore.getState().patchSettings({ width: 832, height: 1216, steps: 30, seed: 15, vibe: [ref] });
  await prepareImageImport(recipeFile());
  assert.equal(applyImageImport("img2img"), true);
  const s = useStore.getState();
  assert.equal(s.settings.prompt, "current draft");
  assert.equal(s.settings.negativePrompt, "current negative");
  assert.equal(s.settings.steps, 30);
  assert.equal(s.settings.seed, 15);
  assert.equal(s.settings.model, V5_FULL);
  assert.deepEqual(s.settings.vibe, [ref]);
  assert.deepEqual([s.settings.width, s.settings.height], [64, 64]);
  assert.equal(s.selectedImage?.dataUrl, s.settings.imageSource?.dataUrl);
  assert.equal(s.imageImport, null);
});

test("both reference purposes append to their own list and select 4.5 Full from any starting model", async t => {
  const network = decodeImages(t);
  for (const model of [V5_FULL, V5_CURATED, Model.V4_5_CUR, Model.V4, Model.V3, Model.V4_5] as const) {
    for (const purpose of ["vibe", "directorReference"] as const) {
      useStore.getState().patchSettings({ model, width: 832, height: 1216, vibe: [ref], directorReference: [ref] });
      const before = useStore.getState().settings;
      const file = recipeFile();
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      await prepareImageImport(file);
      assert.equal(applyImageImport(purpose), true);
      const s = useStore.getState();
      assert.equal(s.settings.model, Model.V4_5);
      assert.deepEqual(s.settings[purpose], [ref, { base64, preview: `data:image/png;base64,${base64}`, strength: 0.6, informationExtracted: 1 }]);
      assert.deepEqual(s.settings[purpose === "vibe" ? "directorReference" : "vibe"], [ref]);
      assert.equal(s.settings.prompt, before.prompt);
      assert.equal(s.settings.negativePrompt, before.negativePrompt);
      assert.deepEqual([s.settings.width, s.settings.height], [832, 1216]);
      assert.equal(s.settings.imageSource, null);
      assert.equal(s.selectedImage, null);
      assert.equal(s.imageImport, null);
    }
  }
  assert.equal(network.mock.calls.length, 0);
});

test("broken embedded parameters leave a valid image usable as a reference", async t => {
  decodeImages(t);
  // A malformed compressed text chunk makes metadata extraction fail while bitmap decoding succeeds.
  const file = new File([concat(new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR", concat(u32(64), u32(64), new Uint8Array([8,6,0,0,0]))),
    chunk("zTXt", utf("Comment\0\0invalid compressed content")), chunk("IEND", new Uint8Array()))], "bad-metadata.png", { type: "image/png" });
  assert.equal(await prepareImageImport(file), true);
  assert.equal(useStore.getState().imageImport?.metadataError, true);
  assert.equal(applyImageImport("recipe"), false);
  assert.equal(applyImageImport("directorReference"), true);
});

test("a corrupt image cannot open a choice or change settings", async t => {
  decodeImages(t);
  t.mock.method(globalThis, "createImageBitmap", async () => { throw new Error("Invalid image"); });
  const before = useStore.getState().settings;
  assert.equal(await prepareImageImport(png()), false);
  assert.equal(useStore.getState().imageImport, null);
  assert.equal(useStore.getState().settings, before);
});

test("a NovelAI software marker without generation fields does not offer parameter import", async t => {
  decodeImages(t);
  const file = new File([concat(new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR", concat(u32(64), u32(64), new Uint8Array([8,6,0,0,0]))),
    chunk("tEXt", utf("Software\0NovelAI")), chunk("IEND", new Uint8Array()))], "marker-only.png", { type: "image/png" });
  assert.equal(await prepareImageImport(file), true);
  assert.equal(useStore.getState().imageImport?.recipe, null);
  assert.equal(applyImageImport("recipe"), false);
  assert.equal(applyImageImport("img2img"), true);
});

test("the latest drop wins even when an earlier image decodes afterwards", async t => {
  decodeImages(t);
  let finishFirst!: (bitmap: ImageBitmap) => void;
  const firstBitmap = new Promise<ImageBitmap>(resolve => { finishFirst = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let count = 0;
  t.mock.method(globalThis, "createImageBitmap", async () => {
    if (++count === 1) { markStarted(); return firstBitmap; }
    return { width: 64, height: 64, close() {} } as ImageBitmap;
  });
  const first = prepareImageImport(new File([png()], "first.png", { type: "image/png" }));
  await started;
  assert.equal(await prepareImageImport(new File([png()], "second.png", { type: "image/png" })), true);
  finishFirst({ width: 64, height: 64, close() {} } as ImageBitmap);
  assert.equal(await first, false);
  assert.equal(useStore.getState().imageImport?.filename, "second.png");
});

test("busy state is checked after decoding and before applying a choice", async t => {
  decodeImages(t);
  let count = 0;
  t.mock.method(globalThis, "createImageBitmap", async () => {
    if (++count === 1) useStore.setState({ isGenerating: true });
    return { width: 64, height: 64, close() {} } as ImageBitmap;
  });
  const before = useStore.getState().settings;
  assert.equal(await prepareImageImport(png()), false);
  assert.equal(useStore.getState().imageImport, null);
  useStore.setState({ isGenerating: false });
  await prepareImageImport(png());
  useStore.setState({ isPreparing: true });
  assert.equal(applyImageImport("vibe"), false);
  assert.equal(useStore.getState().settings, before);
});

test("the direct-import helper still applies recipes and base images without a dialog", async t => {
  decodeImages(t);
  assert.equal(await importRecipeFile(recipeFile()), true);
  assert.equal(useStore.getState().settings.prompt, "saved prompt");
  assert.equal(useStore.getState().imageImport, null);
  useStore.getState().patchSettings({ prompt: "new draft" });
  assert.equal(await importRecipeFile(png()), true);
  assert.equal(useStore.getState().settings.prompt, "new draft");
  assert.equal(useStore.getState().settings.imageSource?.mode, "img2img");
  assert.equal(useStore.getState().imageImport, null);
});

test("selected metadata import preserves unchecked drafts, seed, sampling and image inputs", async t => {
  decodeImages(t);
  const source = { dataUrl: "original", width: 64, height: 64, mode: "img2img" as const, strength: 0.4, noise: 0.2, inpaintStrength: 1 };
  useStore.getState().patchSettings({ imageSource: source, seed: 16, steps: 33, vibe: [ref] });
  await prepareImageImport(recipeFile());
  const options = { ...DEFAULT_RECIPE_IMPORT, negativePrompt: false, characters: false, settings: false, seed: false };
  assert.equal(applyImageImport("recipe", options), true);
  const s = useStore.getState().settings;
  assert.equal(s.prompt, "saved prompt");
  assert.equal(s.negativePrompt, "current negative");
  assert.equal(s.seed, 16); assert.equal(s.steps, 33);
  assert.deepEqual(s.imageSource, source); assert.deepEqual(s.vibe, [ref]);
});

test("append and clean imports have explicit behavior; selecting no fields changes nothing", async t => {
  decodeImages(t);
  await prepareImageImport(recipeFile());
  const onlyPrompts = { ...DEFAULT_RECIPE_IMPORT, characters: false, settings: false, seed: false, append: true };
  assert.equal(applyImageImport("recipe", onlyPrompts), true);
  assert.equal(useStore.getState().settings.prompt, "current draft, saved prompt");
  assert.equal(useStore.getState().settings.negativePrompt, "current negative, saved negative");
  await prepareImageImport(recipeFile());
  const previous = useStore.getState().settings;
  assert.equal(applyImageImport("recipe", { ...onlyPrompts, prompt: false, negativePrompt: false, clean: true }), false);
  assert.equal(useStore.getState().settings, previous);
  assert.equal(applyImageImport("recipe", { ...onlyPrompts, append: false, clean: true }), true);
  assert.equal(useStore.getState().settings.steps, DEFAULT_SETTINGS.steps);
  assert.equal(useStore.getState().settings.prompt, "saved prompt");
});

test("drop and direct imports warn about missing inpainting inputs without inventing a base or mask", async t => {
  decodeImages(t);
  const warning = t.mock.method(toast, "warning", () => 0);
  const file = png(JSON.stringify({ prompt: "repair seam", steps: 22, model: "nai-diffusion-4-5-full-inpainting", action: "infill", inpaintImg2ImgStrength: 0.6 }));
  await prepareImageImport(file);
  assert.deepEqual(useStore.getState().imageImport?.recipe?.reproductionWarnings, ["infill"]);
  assert.equal(applyImageImport("recipe"), true);
  assert.equal(useStore.getState().settings.imageSource, null);
  assert.equal(useStore.getState().settings.model, Model.V4_5);
  assert.match(String(warning.mock.calls[0].arguments[0]), /original base image and mask/);
  assert.equal(await importRecipeFile(file), true);
  assert.equal(warning.mock.calls.length, 2);
});
