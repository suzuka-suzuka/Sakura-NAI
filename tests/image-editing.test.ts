import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type ImageSource } from "../lib/nai/types";
import { buildPayload } from "../lib/nai/payload";
import { estimateCost, augmentCost, upscaleCost } from "../lib/nai/cost";
import { Model } from "../lib/nai/protocol";
import { floodFill, opaqueMask } from "../lib/canvas-tools";
import { saveSettings, NaiClient } from "../lib/nai/client";
import { generationSize } from "../lib/nai/models";
import { quantizePalette } from "../lib/pixel-snap";
import { imageToolSettings, activeGenerationSettings, enhanceFactors, enhancePrompt, imageToolOutputSize, ENHANCE_LEVELS, type Enhancement } from "../lib/nai/image-tools";

const source: ImageSource = { dataUrl:"data:image/png;base64,c291cmNl", width:832, height:1216, mode:"img2img", strength:0.7, noise:0, inpaintStrength:1 };
test("enhancement follows the current sidebar recipe and keeps its own source, size, batch and seed", () => {
  const selected = { dataUrl: source.dataUrl, settings: { ...DEFAULT_SETTINGS, prompt: "old prompt", steps: 28, seed: 17 } };
  const current = { ...DEFAULT_SETTINGS, model: Model.V4_5, prompt: "edited prompt", negativePrompt: "edited negative", steps: 23, scale: 7, cfgRescale: 0.4, sampler: "k_dpmpp_2m" as typeof DEFAULT_SETTINGS.sampler, nSamples: 3, seed: 123,
    characters: [{ prompt: "girl, red coat", uc: "blue", center: { x: 0.2, y: 0.7 }, enabled: true }],
    directorReference: [{ base64: "reference", preview: "", strength: 0.7, informationExtracted: 1 }], imageSource: { ...source, mode: "infill" as const, mask: "dormant mask" } };
  const enhancement: Enhancement = { source: selected, factor: 1.5, magnitude: 1, ...ENHANCE_LEVELS[0], advanced: false };
  const s = activeGenerationSettings(current, enhancement), p = buildPayload(s, 42);
  assert.equal(s.model, Model.V4_5); assert.match(s.prompt, /^edited prompt/);
  assert.equal(s.negativePrompt, current.negativePrompt); assert.equal(s.steps, 23); assert.equal(s.scale, 7); assert.equal(s.cfgRescale, 0.4);
  assert.equal(s.sampler, current.sampler); assert.deepEqual(s.characters, current.characters); assert.deepEqual(s.directorReference, current.directorReference);
  assert.equal(p.action, "img2img"); assert.equal(p.parameters.mask, undefined); assert.equal(p.parameters.image, "c291cmNl");
  assert.equal(p.parameters.strength, 0.2); assert.equal(p.parameters.noise, 0); assert.equal(s.nSamples, 1); assert.equal(s.seed, -1);
  assert.deepEqual([s.width, s.height], [1280, 1856]);
  assert.equal(current.prompt, "edited prompt"); assert.equal(selected.settings.prompt, "old prompt");
  assert.equal(activeGenerationSettings(current, null), current);
});
test("official magnitude values, ordinary enhancement and Max use their actual billed canvas", () => {
  assert.deepEqual(ENHANCE_LEVELS.map(s => [s.strength, s.noise]), [[0.2,0],[0.4,0],[0.5,0],[0.6,0],[0.7,0.1]]);
  const selected = { dataUrl: source.dataUrl, settings: DEFAULT_SETTINGS };
  const opus = { tier: 3, active: true, anlas: 1000, usage: { percent: 50, isNegative: false } };
  const prices = [1, 1.5, "max"].map(factor => {
    const s = imageToolSettings(selected, "enhance", { factor: factor as 1 | 1.5 | "max", strength: 0.2 });
    return [estimateCost(s, null).total, estimateCost(s, opus).total];
  });
  assert.deepEqual(prices, [[6,0],[14,14],[18,18]]);
  const s = imageToolSettings(selected, "enhance", { factor: "max", strength: 0.2 });
  assert.deepEqual([s.width,s.height],[832,1216]);
  assert.deepEqual(imageToolOutputSize(s), { width: 1467, height: 2144 });
  assert.equal(buildPayload(s,42).parameters.upscaled_enhance, true);
  assert.equal(s.prompt, DEFAULT_SETTINGS.prompt);
  assert.equal(estimateCost({...s,steps:23},opus).total,16);
  assert.equal(estimateCost({...s,steps:50,imageSource:{...s.imageSource!,strength:0.99}},opus).valid,false);
  const normal = imageToolSettings(selected,"enhance",{factor:1});
  assert.equal(buildPayload(normal,42).parameters.upscaled_enhance,undefined);
  assert.equal(estimateCost(normal,{...opus,usage:{percent:0,isNegative:true}}).total,15);
  assert.throws(()=>buildPayload({...s,model:Model.V4_5},42),/Max enhancement/);
});
test("Max tracks the active model and unavailable scale selections fall back before pricing or submission", () => {
  const selected = { dataUrl: source.dataUrl, settings: DEFAULT_SETTINGS };
  assert.deepEqual(enhanceFactors(selected,DEFAULT_SETTINGS.model),[1,1.5,"max"]);
  assert.deepEqual(enhanceFactors(selected,Model.V4_5),[1,1.5]);
  const e: Enhancement = { source:selected,factor:"max",magnitude:3,...ENHANCE_LEVELS[2],advanced:false };
  const legacy = activeGenerationSettings({...DEFAULT_SETTINGS,model:Model.V4_5},e);
  assert.equal(legacy.imageSource?.upscaledEnhance,undefined); assert.deepEqual([legacy.width,legacy.height],[1280,1856]);
  assert.deepEqual(enhanceFactors({...selected,settings:{...DEFAULT_SETTINGS,width:1600,height:1600}},DEFAULT_SETTINGS.model),[1]);
  assert.deepEqual(enhanceFactors({...selected,settings:{...DEFAULT_SETTINGS,width:768,height:1024}},DEFAULT_SETTINGS.model),[1,1.5,2,"max"]);
});
test("enhancement tags stay outside manual rendered text and are not duplicated", () => {
  assert.equal(enhancePrompt("cat, text: Hello"),"cat, -2::upscaled, blurry::,, text: Hello");
  assert.equal(enhancePrompt("cat, text:: Hello"),"cat, text:: Hello, -2::upscaled, blurry::,");
  const prompt=enhancePrompt("cat"); assert.equal(enhancePrompt(prompt),prompt);
});
test("image toolbar prices and submitted variations use the selected image and the same parameters", () => {
  const selected = { dataUrl: source.dataUrl, settings: { ...DEFAULT_SETTINGS, prompt: "selected prompt", seed: 19 } };
  const variants = imageToolSettings(selected, "variations", { factor: 2, strength: 0.51, noise: 0.2 });
  const account = { tier: 3, active: true, anlas: 1000, usage: { percent: 50, isNegative: false } };
  assert.equal(estimateCost(variants, account).total, 48);
  assert.equal(upscaleCost(selected.settings.width, selected.settings.height), 1);
  const payload = buildPayload(variants, 23);
  assert.equal(payload.action, "img2img");
  assert.equal(payload.parameters.n_samples, 4);
  assert.equal(payload.parameters.strength, 0.51);
  assert.equal(payload.parameters.noise, 0.2);
  assert.equal(payload.parameters.width, selected.settings.width);
  assert.equal(payload.parameters.height, selected.settings.height);
  assert.equal(selected.settings.seed, 19);
  assert.equal(estimateCost(imageToolSettings(selected, "variations", { strength: 0.8 }), account).total, 72);
});
test("processed images fit the generation grid and dedicated upscale has four price buckets", () => {
  for(const [w,h] of [[416,608],[4096,4096],[3328,4864],[100,4000]]){
    const s=generationSize(w,h);assert.equal(s.width%64,0);assert.equal(s.height%64,0);assert.ok(s.width<=2048&&s.height<=2048&&s.width*s.height<=3145728);
  }
  assert.deepEqual([1048576,1747627,2446678,3145728].map(n=>upscaleCost(n,1)),[1,2,3,4]);
  assert.equal(upscaleCost(2048,2048),null);
  assert.equal(augmentCost(512,512,true,null),65);
  assert.equal(augmentCost(512,512,false,null),20);
});
test("pixel-art palette reduction preserves alpha and limits opaque colors", () => {
  const data=new Uint8ClampedArray([255,0,0,255, 250,0,0,255, 0,0,255,255, 0,0,250,128, 20,20,20,0]);
  quantizePalette(data,2);
  assert.equal(data[15],128);assert.equal(data[19],0);
  const colors=new Set();for(let i=0;i<16;i+=4)colors.add([...data.slice(i,i+3)].join(","));
  assert.equal(colors.size,2);
});
test("V5 image2image uses observed official action, independent noise seed and explicit image bytes", () => {
  const p = buildPayload({...DEFAULT_SETTINGS, imageSource:source}, 100);
  assert.equal(p.action,"img2img"); assert.equal(p.model,"nai-diffusion-5-full");
  assert.equal(p.parameters.image,"c291cmNl"); assert.equal(p.parameters.strength,0.7);
  assert.equal(p.parameters.extra_noise_seed,99); assert.equal(p.parameters.mask,undefined);
  assert.equal(p.parameters.color_correct,false); assert.equal(p.parameters.add_original_image,true);
});
test("inpainting uses matching canvas/mask, dedicated model, and rejects incomplete masks before network I/O", () => {
  const imageSource = {...source, mode:"infill" as const, mask:"data:image/png;base64,bWFzaw=="};
  const p = buildPayload({...DEFAULT_SETTINGS,imageSource},0);
  assert.equal(p.action,"infill"); assert.equal(p.model,"nai-diffusion-5-full-inpainting");
  assert.equal(p.parameters.mask,"bWFzaw=="); assert.equal(p.parameters.inpaintImg2ImgStrength,1);
  assert.equal(p.parameters.add_original_image,false); assert.equal(p.parameters.extra_noise_seed,4294967295);
  assert.throws(()=>buildPayload({...DEFAULT_SETTINGS,imageSource:{...imageSource,mask:undefined}},0),/mask/);
  assert.throws(()=>buildPayload({...DEFAULT_SETTINGS,width:1024,imageSource},0),/dimensions/);
  assert.throws(()=>buildPayload({...DEFAULT_SETTINGS,imageSource:{...source,strength:NaN}},0),/strength/);
});
test("image strength is applied after rounded step cost, and inpainting never charges dormant references", () => {
  assert.equal(estimateCost({...DEFAULT_SETTINGS,imageSource:source},null).total,21);
  assert.equal(estimateCost({...DEFAULT_SETTINGS,imageSource:{...source,strength:0.51}},null).total,16);
  const imageSource={...source,mode:"infill" as const,mask:"test",inpaintStrength:0.5};
  const s={...DEFAULT_SETTINGS,model:Model.V4_5,imageSource,vibe:Array(8).fill({base64:"a",preview:"",strength:1,informationExtracted:1})};
  assert.equal(estimateCost(s,null,8).total,10);
  assert.equal(new NaiClient({host:"https://example.invalid",token:"test",maxRetries:0,baseDelay:0}).uncachedVibes(s),0);
});
test("Furry mode adds exactly one dataset prefix, leaving the saved prompt untouched", () => {
  const s={...DEFAULT_SETTINGS,promptMode:"furry" as const,prompt:"fox"};
  assert.match(buildPayload(s,1).input,/^fur dataset, fox/); assert.equal(s.prompt,"fox");
  assert.equal(buildPayload({...s,prompt:"fur dataset, fox"},1).input,buildPayload(s,1).input);
});
test("flood fill stays inside a contiguous color region and mask export is opaque black/white", () => {
  const pixels=new Uint8ClampedArray([0,0,0,0, 255,0,0,255, 0,0,0,0, 0,0,0,0, 255,0,0,255, 0,0,0,0]);
  floodFill(pixels,3,2,0,0,[0,255,0,255]);
  assert.deepEqual([...pixels.slice(0,4)],[0,255,0,255]);assert.deepEqual([...pixels.slice(12,16)],[0,255,0,255]);
  assert.equal(pixels[11],0); assert.equal(pixels[23],0);
  assert.deepEqual([...opaqueMask(new Uint8ClampedArray([3,4,5,0, 3,4,5,20]))],[0,0,0,255,255,255,255,255]);
});
test("draft persistence excludes large base images and masks", t => {
  let saved="";
  const old=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{setItem:(_key:string,v:string)=>{saved=v;}}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,"localStorage",old);else Reflect.deleteProperty(globalThis,"localStorage");});
  saveSettings({...DEFAULT_SETTINGS,prompt:"preserve",imageSource:source});
  const data=JSON.parse(saved);assert.equal(data.prompt,"preserve");assert.equal(data.imageSource,undefined);
});
