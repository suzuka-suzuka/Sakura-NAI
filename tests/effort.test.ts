import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { V5_CURATED, V5_FULL, V5_FULL_MEDIUM, isV5Model, supportsStreaming } from "../lib/nai/models";
import { buildPayload } from "../lib/nai/payload";
import { estimateCost, parseAccount } from "../lib/nai/cost";
import { effectiveEffortSettings } from "../lib/nai/effort";
import { recipeFromNovelAIMetadata } from "../lib/nai/import-recipe";
import { Sampler } from "../lib/nai/protocol";

const settings: GenerationSettings = { ...DEFAULT_SETTINGS, model: V5_FULL_MEDIUM, steps: 40, sampler: Sampler.DPM2M,
  cfgRescale:0.7, negativePrompt:"custom negative", ucPreset:3 as const,
  characters:[{prompt:"girl",uc:"character negative",enabled:true,center:{x:0.3,y:0.6}}] };

test("Medium overrides the wire settings without destroying saved High settings", () => {
  const original = structuredClone(settings);
  const body = buildPayload(settings,42), p = body.parameters;
  assert.equal(body.model,V5_FULL_MEDIUM);
  assert.equal(isV5Model(settings.model),true); assert.equal(supportsStreaming(settings.model),true);
  assert.equal(p.steps,14); assert.equal(p.sampler,Sampler.EULER_ANC); assert.equal(p.cfg_rescale,0);
  assert.equal(p.ucPresetId,"heavy"); assert.equal(p.tag_hint_uc_preset,2);
  assert.match(p.negative_prompt as string,/lowres/); assert.doesNotMatch(p.negative_prompt as string,/custom negative/);
  assert.equal((p.characterPrompts as {uc:string}[])[0].uc,"");
  assert.equal((p.v4_negative_prompt as {caption:{char_captions:{char_caption:string}[]}}).caption.char_captions[0].char_caption,"");
  assert.deepEqual(settings,original);
  const high = buildPayload({...settings,model:V5_FULL},42).parameters;
  assert.equal(high.steps,40); assert.equal(high.sampler,Sampler.DPM2M); assert.equal(high.cfg_rescale,0.7);
  assert.equal(high.negative_prompt,"custom negative");
  assert.equal(effectiveEffortSettings(settings).steps,14);
});

test("Medium quote matches relay for standard, large and batched Opus generation", () => {
  const standard = {tier:1,active:true,anlas:100,usage:null};
  const opus = {...standard,tier:3,usage:{percent:50,isNegative:false}};
  assert.equal(estimateCost(settings,standard).total,17);
  assert.equal(estimateCost({...settings,width:1536,height:1536},standard).total,38);
  assert.equal(estimateCost(settings,opus).total,0);
  assert.equal(estimateCost({...settings,nSamples:2},opus).total,17);
  assert.equal(estimateCost(settings,{...opus,usage:{percent:0,isNegative:true}}).total,17);
});

test("Relay quotes Medium and regular V5 from exact stamina, with legacy allowance fallback", () => {
  const subscription = { tier: 3, active: true, usage: { percent: 0, isNegative: true } };
  const quoteAccount = (availableImagesExact: unknown) => parseAccount({
    ...subscription,
    relay: { stamina: { availableImagesExact, capacityImages: 280 } },
  });

  const half = quoteAccount(0.5);
  assert.equal(half.relayStaminaImages, 0.5);
  assert.equal(estimateCost(settings, half).total, 0);
  assert.equal(estimateCost({ ...settings, nSamples: 2 }, half).total, 17);
  assert.equal(estimateCost({ ...settings, width: 1536, height: 1536 }, half).total, 38);
  for (const model of [V5_FULL, V5_CURATED] as const) {
    const regular = { ...settings, model, steps: 23 };
    assert.equal(estimateCost(regular, half).total, 26);
    assert.equal(estimateCost(regular, quoteAccount(1)).total, 0);
  }
  for (const belowHalf of [0.49, 0]) {
    assert.equal(estimateCost(settings, quoteAccount(belowHalf)).total, 17);
  }
  assert.equal(estimateCost(settings, { ...half, tier: 1 }).total, 17);

  const legacy = parseAccount({ ...subscription, usage: { percent: 0, isNegative: false },
    relay: { stamina: { availableImages: 1 } } });
  assert.equal(legacy.relayStaminaImages, undefined);
  assert.equal(estimateCost(settings, legacy).total, 0);
  for (const invalid of ["0.5", -1, Infinity]) {
    const account = quoteAccount(invalid);
    assert.equal(account.relayStaminaImages, undefined);
    assert.equal(estimateCost(settings, account).total, 17);
  }
});

test("Medium inpainting keeps its model and fixed settings", () => {
  const body = buildPayload({...settings,imageSource:{dataUrl:"data:image/png;base64,AA==",mask:"data:image/png;base64,AA==",width:832,height:1216,strength:0.7,noise:0,mode:"infill",inpaintStrength:1}},42);
  assert.equal(body.model,V5_FULL_MEDIUM+"-inpainting"); assert.equal(body.action,"infill");
  assert.equal(body.parameters.steps,14);
});

test("Imported Medium model IDs and official source hashes preserve effort", () => {
  for (const source of [V5_FULL_MEDIUM,V5_FULL_MEDIUM+"-inpainting","NovelAI Diffusion V5 93F4BD30","NovelAI Diffusion V5 70AB5786"]) {
    const recipe = recipeFromNovelAIMetadata([{keyword:"Source",text:source},{keyword:"Comment",text:JSON.stringify({prompt:"test",steps:14})}], {width:832,height:1216});
    assert.equal(recipe?.settings.model,V5_FULL_MEDIUM);
  }
});
