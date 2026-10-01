import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { useStore } from "../lib/store";
import { NaiClient, loadUIPrefs } from "../lib/nai/client";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { V5_FULL, V5_CURATED } from "../lib/nai/models";
import { EventType, Image, Model } from "../lib/nai/protocol";
import { estimateCost, parseAccount, type AccountInfo } from "../lib/nai/cost";
import { qualityText, negativeText, NEGATIVE_PRESETS, QUALITY_PRESETS } from "../lib/nai/presets";
import { buildPayload } from "../lib/nai/payload";
import { fitPreviewGrid } from "../lib/preview-layout";
import type { GalleryImage } from "../lib/db/gallery";
import { characterKind } from "../lib/nai/characters";
import { activeGenerationSettings, imageToolOutputSize } from "../lib/nai/image-tools";

const opus: AccountInfo = { tier: 3, active: true, anlas: 1000, usage: { percent: 30, isNegative: false } };
const cfg = { host: "https://example.invalid", token: "not-a-real-token", maxRetries: 0, baseDelay: 0 };
const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({ ...DEFAULT_SETTINGS, model: V5_FULL, prompt: "cat", ...patch });
const image = new Image(new Uint8Array([137,80,78,71,13,10,26,10]));
const oldImage: GalleryImage = { id: 100, batchId: 50, batchIndex: 0, batchSize: 1, dataUrl: "data:image/png;base64,old", filename: "old.png", seed: 1, settings: settings({ prompt: "old prompt" }), timestamp: new Date().toISOString() };
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  useStore.setState(useStore.getInitialState(), true);
});
function setup(t: TestContext, patch: Partial<GenerationSettings> = {}) {
  const client = new NaiClient(cfg);
  t.mock.method(client, "account", async () => opus);
  const generate = t.mock.method(client, "generate", async (s: GenerationSettings, preview = true) => ({
    seed: 123, streaming: preview,
    events: (async function* () { for (let i = 0; i < s.nSamples; i++) yield { event_type: EventType.FINAL, samp_ix: i, step_ix: s.steps, image }; })(),
  }));
  useStore.setState({ client, account: opus, settings: settings(patch), connection: cfg });
  return { client, generate };
}

test("focused inpainting saves full output dimensions while restoring its priced detail request", async t => {
  const imageSource={dataUrl:"data:image/png;base64,source",width:640,height:768,mode:"infill" as const,mask:"mask",strength:0.7,noise:0,inpaintStrength:1,focused:true};
  const {generate}=setup(t,{model:Model.V4_5,width:1024,height:1024,imageSource});
  await useStore.getState().generate();
  const result=useStore.getState().selectedImage!;
  assert.deepEqual([generate.mock.calls[0].arguments[0].width,generate.mock.calls[0].arguments[0].height],[1024,1024]);
  assert.deepEqual([result.settings.width,result.settings.height],[640,768]);
  assert.deepEqual(result.settings.imageSource?.focusedTarget,{width:1024,height:1024});
  useStore.getState().restoreSettings(result.settings);
  assert.deepEqual([useStore.getState().settings.width,useStore.getState().settings.height],[1024,1024]);
  assert.equal(estimateCost(useStore.getState().settings,opus).total,0);
});

test("V5 preset tooltips and actual payload use identical official text", () => {
  for (const quality of QUALITY_PRESETS) {
    const s = settings({ qualityPreset: quality.value, qualityToggle: quality.value !== "none" });
    assert.equal(qualityText(s), quality.text);
    assert.equal(buildPayload(s, 1).input, ["cat", quality.text].filter(Boolean).join(", "));
  }
  for (const negative of NEGATIVE_PRESETS) {
    const s = settings({ ucPreset: negative.value, negativePrompt: "user negative" });
    assert.equal(negativeText(s), negative.text);
    assert.equal(buildPayload(s, 1).parameters.negative_prompt, [negative.text, "user negative"].filter(Boolean).join(", "));
  }
  assert.equal(qualityText(settings({ qualityToggle: false })), "");
  assert.equal(negativeText(settings({ ucPreset: 3 })), "");
});

test("image-tool generation submits its snapshot without replacing the active draft", async t => {
  const {generate}=setup(t,{prompt:"unfinished draft"});
  const submitted=settings({prompt:"selected image prompt",imageSource:{dataUrl:"data:image/png;base64,c2FtcGxl",width:832,height:1216,mode:"img2img",strength:0.5,noise:0,inpaintStrength:1}});
  await useStore.getState().generate(undefined,submitted);
  assert.equal(generate.mock.calls.length,1);
  assert.equal(generate.mock.calls[0].arguments[0].prompt,"selected image prompt");
  assert.equal(useStore.getState().settings.prompt,"unfinished draft");
  assert.equal(useStore.getState().images[0].settings.imageSource?.strength,0.5);
});

test("sidebar enhancement submission uses edits made while the panel is open", async t => {
  const { generate } = setup(t,{prompt:"draft before enhancing"});
  useStore.getState().beginEnhancement(oldImage);
  useStore.getState().patchEnhancement({factor:1,magnitude:1});
  useStore.getState().patchSettings({prompt:"new sidebar prompt",negativePrompt:"new negative",steps:22,scale:6.5,cfgRescale:0.25});
  const before=useStore.getState().settings;
  const quote=activeGenerationSettings(before,useStore.getState().enhancement);
  assert.equal(estimateCost(quote,opus).total,0);
  await useStore.getState().generate();
  assert.equal(generate.mock.calls.length,1);
  const submitted=generate.mock.calls[0].arguments[0];
  assert.deepEqual(submitted,quote);
  assert.match(submitted.prompt,/^new sidebar prompt/); assert.equal(submitted.steps,22); assert.equal(submitted.scale,6.5);
  assert.equal(submitted.imageSource?.dataUrl,oldImage.dataUrl); assert.equal(submitted.imageSource?.strength,0.2);
  assert.deepEqual(useStore.getState().settings,before); assert.equal(useStore.getState().enhancement,null);
});

test("Max enhancement's paid confirmation freezes its quote and saves the expanded output dimensions", async t => {
  const { generate } = setup(t,{prompt:"confirmed prompt",steps:23});
  useStore.getState().beginEnhancement(oldImage);
  useStore.getState().patchEnhancement({factor:"max",magnitude:1});
  const quote=activeGenerationSettings(useStore.getState().settings,useStore.getState().enhancement);
  await useStore.getState().generate();
  assert.equal(generate.mock.calls.length,0);
  assert.equal(useStore.getState().pendingPayment?.cost,16);
  assert.deepEqual(useStore.getState().pendingPayment?.settings,quote);
  useStore.getState().patchSettings({prompt:"changed after confirmation opened",steps:50});
  useStore.getState().patchEnhancement({magnitude:5});
  await useStore.getState().confirmPayment();
  assert.equal(generate.mock.calls.length,1);
  assert.deepEqual(generate.mock.calls[0].arguments[0],quote);
  const saved=useStore.getState().images[0].settings;
  assert.deepEqual({width:saved.width,height:saved.height},imageToolOutputSize(quote));
  assert.equal(saved.imageSource,null);
  assert.equal(useStore.getState().settings.prompt,"changed after confirmation opened");
});

test("advanced visibility preserves custom strength/noise and closing enhancement preserves the sidebar draft", () => {
  useStore.setState({settings:settings({prompt:"untouched draft"})});
  const before=useStore.getState().settings;
  useStore.getState().beginEnhancement(oldImage);
  useStore.getState().patchEnhancement({advanced:true,strength:0.33,noise:0.12});
  useStore.getState().patchEnhancement({advanced:false});
  assert.equal(useStore.getState().enhancement?.strength,0.33);
  assert.equal(useStore.getState().enhancement?.noise,0.12);
  useStore.getState().patchEnhancement({advanced:true});
  assert.equal(useStore.getState().enhancement?.strength,0.33);
  useStore.getState().patchEnhancement({magnitude:5});
  assert.equal(useStore.getState().enhancement?.strength,0.7); assert.equal(useStore.getState().enhancement?.noise,0.1);
  useStore.getState().closeEnhancement();
  assert.equal(useStore.getState().enhancement,null); assert.deepEqual(useStore.getState().settings,before);
});

test("paid reminder follows enhancement's effective cost when switching between paid and free factors", () => {
  useStore.setState({settings:settings(),account:opus});
  useStore.getState().beginEnhancement(oldImage);
  useStore.setState({paidAcknowledged:true});
  assert.equal(useStore.getState().paidAcknowledged,true);
  useStore.getState().patchEnhancement({factor:1});
  assert.equal(useStore.getState().paidAcknowledged,false);
  useStore.getState().patchEnhancement({factor:"max"});
  assert.equal(useStore.getState().paidAcknowledged,false);
});

test("reordering characters preserves names, both prompts and coordinates", () => {
  const characters=[{id:"a",name:"bird",prompt:"blue bird",uc:"red",center:{x:0.2,y:0.3},enabled:true},{id:"b",name:"cat",prompt:"cat",uc:"dog",center:{x:0.8,y:0.7},enabled:false}];
  useStore.setState({settings:settings({characters})});
  useStore.getState().moveCharacter(0,1);
  assert.deepEqual(useStore.getState().settings.characters,[characters[1],characters[0]]);
  useStore.getState().moveCharacter(-1,0);
  assert.deepEqual(useStore.getState().settings.characters,[characters[1],characters[0]]);
});
test("Female, Male and Other create real captions and preserve existing character content", () => {
  for (const [kind, prompt] of [["female", "girl, "], ["male", "boy, "], ["other", ""]] as const) {
    useStore.getState().addCharacter(kind);
    const characters = useStore.getState().settings.characters;
    assert.equal(characters.at(-1)?.prompt, prompt);
    assert.equal(characters.at(-1)?.uc, "");
    assert.equal(characters.at(-1)?.collapsed, false);
    assert.equal(characterKind(prompt), kind);
    assert.ok(characters.slice(0, -1).every(c => c.collapsed));
  }
  const current = useStore.getState().settings;
  assert.deepEqual(current.characters.map(c => c.prompt), ["girl, ", "boy, ", ""]);
  const p = buildPayload(current, 1).parameters.v4_prompt as { caption: { char_captions: { char_caption: string }[] } };
  assert.deepEqual(p.caption.char_captions.map(c => c.char_caption), ["girl, ", "boy, "]);
  useStore.getState().updateCharacter(2, { prompt: "cat" });
  const edited = buildPayload(useStore.getState().settings, 1).parameters.v4_prompt as typeof p;
  assert.equal(edited.caption.char_captions[2].char_caption, "cat");
  assert.equal(characterKind("1girl, blue coat"), "female");
  assert.equal(characterKind("boy, green coat"), "male");
  assert.equal(characterKind("girl, boy"), "other");
});
test("V5 pricing accounts for resolution, steps, batch discount, subscription and exhausted/unknown allowance", () => {
  assert.equal(estimateCost(settings(), opus).total, 0);
  assert.equal(estimateCost(settings({ steps: 29 }), opus).total, 30);
  assert.equal(estimateCost(settings({ width: 1536, height: 1536 }), opus).total, 68);
  assert.equal(estimateCost(settings({ nSamples: 2 }), opus).total, 30);
  assert.equal(estimateCost(settings(), { ...opus, active: false }).total, 30);
  assert.equal(estimateCost(settings(), { ...opus, usage: { percent: 0, isNegative: false } }).total, 0);
  assert.equal(estimateCost(settings(), { ...opus, usage: { percent: 50, isNegative: true } }).total, 30);
  assert.equal(estimateCost(settings(), { ...opus, usage: null }).total, 30);
  assert.equal(estimateCost(settings(), null).total, 30);
  assert.equal(estimateCost(settings({ model: Model.V4_5 }), { ...opus, usage: null }).total, 0);
});

test("AI positioning disables coordinate guidance without losing either character prompt or saved positions", () => {
  for (const model of [V5_FULL, V5_CURATED, Model.V4_5, Model.V4] as const) {
    const characters = [
      { prompt: "blue bird", uc: "red feathers", enabled: true, center: { x: 0.25, y: 0.75 } },
      { prompt: "yellow bird", uc: "blue feathers", enabled: true, center: { x: 0.8, y: 0.3 } },
    ];
    useStore.setState({ settings: settings({ model, characters }) });
    for (const useCoords of [false, true, false]) {
      useStore.getState().patchSettings({ useCoords });
      const current = useStore.getState().settings;
      assert.deepEqual(current.characters, characters);
      const p = buildPayload(current, 1).parameters;
      const positive = p.v4_prompt as { use_coords: boolean; caption: { char_captions: unknown[] } };
      const negative = p.v4_negative_prompt as { caption: { char_captions: unknown[] } };
      assert.equal(p.use_coords, useCoords);
      assert.equal(positive.use_coords, useCoords);
      assert.deepEqual(positive.caption.char_captions, characters.map(c => ({ char_caption: c.prompt, centers: [c.center] })));
      assert.deepEqual(negative.caption.char_captions, characters.map(c => ({ char_caption: c.uc, centers: [c.center] })));
    }
  }
});
test("V5 prices match Launcher reference examples and preserve the rounding order", () => {
  for (const model of [V5_FULL, V5_CURATED] as const) {
    assert.equal(estimateCost(settings({ model, steps: 23 }), null).total, 26);
    assert.equal(estimateCost(settings({ model, width: 1024, height: 1024 }), null).total, 30);
    assert.equal(estimateCost(settings({ model, width: 64, height: 64, steps: 1 }), null).total, 2);
    assert.equal(estimateCost(settings({ model, nSamples: 4, steps: 23 }), opus).total, 78);
    assert.equal(estimateCost(settings({ model, width: 2048, height: 1536, steps: 50 }), opus).valid, false);
  }
  assert.equal(estimateCost(settings({ model: Model.V4_5, steps: 23 }), null).total, 17);
});
test("cancelled renewal retains paid-through Opus benefits; expired subscriptions do not", () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const cancelled = parseAccount({ tier: 3, active: false, expiresAt, usage: { percent: 0, isNegative: false } });
  assert.equal(estimateCost(settings(), cancelled).total, 0);
  assert.equal(estimateCost(settings(), { ...cancelled, active: true, expiresAt: expiresAt - 7200 }).total, 30);
});
test("Vibe request surcharges and encoding are not multiplied by the number of images", () => {
  const ref = { base64: "fixture", preview: "fixture", strength: 0.5, informationExtracted: 1 };
  const cost = estimateCost(settings({ model: Model.V4_5, nSamples: 2, vibe: Array(6).fill(ref) }), opus, 2);
  assert.equal(cost.references, 4);
  assert.equal(cost.encoding, 4);
  assert.equal(cost.total, 28);
});
test("legacy character-tab preference migrates to the combined prompt panel", t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify({ activeTab: "characters", settingsCollapsed: false, galleryOpen: true }) } });
  t.after(() => { if (old) Object.defineProperty(globalThis, "localStorage", old); else Reflect.deleteProperty(globalThis, "localStorage"); });
  assert.deepEqual(loadUIPrefs(), { activeTab: "basic", settingsCollapsed: false, galleryOpen: true, combinedPrompts: false });
});
test("account response validation never guesses Opus from an invalid payload", () => {
  assert.throws(() => parseAccount({}), /Invalid/);
  assert.throws(() => parseAccount({ tier: 3, active: "true" }), /Invalid/);
  assert.equal(parseAccount({ tier: 3, active: true, usage: { percent: 20, isNegative: false }, trainingStepsLeft: { fixedTrainingStepsLeft: 5, purchasedTrainingSteps: 10 } }).anlas, 15);
});
test("adaptive preview fits portrait, landscape and multi-image grids without cropping", () => {
  for (const [w,h] of [[832,1216],[1216,832],[2048,512],[512,2048],[1024,1024]]) {
    for (const n of [1,2,4,8]) for (const [aw,ah] of [[300,450],[980,700],[240,180]]) {
      const layout = fitPreviewGrid(w,h,n,aw,ah);
      assert.ok(layout.width <= aw + 0.001 && layout.height <= ah + 0.001);
      assert.ok(Math.abs(layout.tileWidth / layout.tileHeight - w/h) < 0.0001);
      assert.ok(layout.tileWidth > 0 && layout.tileHeight > 0);
    }
  }
});
test("viewing gallery batches and individual images never replaces authored settings", () => {
  const draft = settings({ prompt: "draft", negativePrompt: "draft negative", seed: 77 });
  useStore.setState({ images: [oldImage], settings: draft });
  useStore.getState().selectBatch(oldImage.batchId);
  assert.equal(useStore.getState().selectedImage, oldImage);
  assert.equal(useStore.getState().settings, draft);
  useStore.getState().selectImage(oldImage);
  assert.equal(useStore.getState().settings, draft);
  useStore.getState().restoreSettings(oldImage.settings);
  assert.equal(useStore.getState().settings.prompt, "old prompt");
});
test("first paid request waits; cancelling never dispatches; one approval lasts until returning to free", async t => {
  const { generate } = setup(t, { steps: 29 });
  await useStore.getState().generate();
  assert.equal(generate.mock.callCount(), 0);
  assert.equal(useStore.getState().pendingPayment?.cost, 30);
  useStore.getState().cancelPayment();
  assert.equal(generate.mock.callCount(), 0);
  await useStore.getState().generate();
  await useStore.getState().confirmPayment();
  assert.equal(generate.mock.callCount(), 1);
  await useStore.getState().generate();
  assert.equal(generate.mock.callCount(), 2);
  useStore.getState().patchSettings({ steps: 28 });
  assert.equal(useStore.getState().paidAcknowledged, false);
  useStore.getState().patchSettings({ steps: 29 });
  await useStore.getState().generate();
  assert.equal(generate.mock.callCount(), 2);
  assert.ok(useStore.getState().pendingPayment);
});
test("reminder can be disabled; price changes after confirmation require a fresh confirmation", async t => {
  const { client, generate } = setup(t, { nSamples: 2 });
  await useStore.getState().generate();
  assert.equal(useStore.getState().pendingPayment?.cost, 30);
  t.mock.method(client, "account", async () => ({ ...opus, usage: { percent: 0, isNegative: true } }));
  await useStore.getState().confirmPayment();
  assert.equal(generate.mock.callCount(), 0);
  assert.equal(useStore.getState().pendingPayment?.cost, 60);
  useStore.getState().cancelPayment();
  useStore.getState().patchPreferences({ confirmPaid: false });
  await useStore.getState().generate();
  assert.equal(generate.mock.callCount(), 1);
});
test("double clicks during account refresh produce only one generation", async t => {
  const { client, generate } = setup(t);
  let resolve!: (value: AccountInfo) => void;
  t.mock.method(client, "account", () => new Promise<AccountInfo>(r => { resolve = r; }));
  const first = useStore.getState().generate();
  await useStore.getState().generate();
  resolve(opus); await first;
  assert.equal(generate.mock.callCount(), 1);
  resolve(opus); // finish post-generation refresh
});
test("over-limit prices never dispatch a generation or request payment confirmation", async t => {
  const { generate } = setup(t, { width: 2048, height: 1536, steps: 50 });
  await useStore.getState().generate();
  assert.equal(generate.mock.callCount(), 0);
  assert.equal(useStore.getState().pendingPayment, null);
  assert.equal(useStore.getState().isPreparing, false);
});
test("preview disabled preserves old image (or empty canvas), submits final-only, and keeps request dimensions", async t => {
  for (const previous of [oldImage, null]) {
    const { client } = setup(t);
    useStore.setState({ preferences: { streamPreview: false, confirmPaid: true }, selectedBatch: previous ? [previous] : null, selectedImage: previous });
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    t.mock.method(client, "generate", async (_s: GenerationSettings, preview: boolean) => {
      assert.equal(preview, false);
      return { seed: 123, streaming: false, events: (async function* () {
        started(); await new Promise<void>(r => { finish = r; });
        yield { event_type: EventType.FINAL, samp_ix: 0, step_ix: 28, image };
      })() };
    });
    const run = useStore.getState().generate(); await ready;
    assert.equal(useStore.getState().selectedImage, previous);
    assert.equal(useStore.getState().runPreview, false);
    useStore.getState().patchSettings({ width: 1216, height: 832 });
    assert.equal(useStore.getState().runSettings?.width, 832);
    finish(); await run;
    assert.equal(useStore.getState().selectedImage?.seed, 123);
    assert.equal(useStore.getState().selectedImage?.settings.width, 832);
  }
});
test("preview off uses generate-image and removes the stream parameter", async t => {
  const client = new NaiClient(cfg);
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://example.invalid/ai/generate-image");
    assert.equal(JSON.parse(String(options.body)).parameters.stream, undefined);
    return Response.json({ images: [{ image: btoa("image bytes") }] });
  });
  const handle = await client.generate(settings(), false);
  assert.equal(handle.streaming, false);
  const events = []; for await (const event of handle.events) events.push(event);
  assert.equal(events.length, 1);
});
