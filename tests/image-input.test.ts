import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { encode } from "@msgpack/msgpack";
import { prepareImageInput } from "../lib/nai/image-input";
import { NaiClient } from "../lib/nai/client";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { Model } from "../lib/nai/protocol";
import { V5_FULL } from "../lib/nai/models";

const source = { dataUrl: "data:image/png;base64,b3JpZ2luYWw=", width: 832, height: 1216,
  mode: "img2img" as const, strength: 0.7, noise: 0.1, inpaintStrength: 1 };
const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({
  ...DEFAULT_SETTINGS, width: 1024, height: 1024, imageSource: { ...source }, ...patch,
});

function mockCanvas(t: TestContext, decode: () => void = () => {}) {
  const draws: { src: string; width: number; height: number }[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries({
    Image: class {
      src = "";
      async decode() { decode(); }
    },
    document: { createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      return { width: 0, height: 0,
        getContext: () => ({ drawImage(image: { src: string }, x: number, y: number, width: number, height: number) {
          assert.deepEqual([x, y], [0, 0]); draws.push({ src: image.src, width, height });
        } }),
        toDataURL(type: string) { assert.equal(type, "image/png"); return `data:image/png;base64,${btoa(`${this.width}x${this.height}`)}`; },
      };
    } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globals[key]; });
  }
  return draws;
}

test("Image2Image resizes the base to the current canvas without changing the imported original", async t => {
  const draws = mockCanvas(t);
  for (const [width, height] of [[1024, 1024], [832, 1024], [1024, 1216]]) {
    const s = settings({ width, height });
    const prepared = await prepareImageInput(s);
    assert.deepEqual(draws.at(-1), { src: source.dataUrl, width, height });
    assert.deepEqual(prepared.imageSource, { ...source, mask: undefined, width, height, dataUrl: `data:image/png;base64,${btoa(`${width}x${height}`)}` });
    assert.deepEqual(s.imageSource, source);
    assert.deepEqual([prepared.width, prepared.height], [width, height]);
  }
  assert.equal(draws.length, 3);
});

test("matching images and text generation skip decoding; Image2Image ignores dormant masks", async t => {
  const draws = mockCanvas(t);
  const text = settings({ imageSource: null });
  assert.equal(await prepareImageInput(text), text);
  for (const mode of ["img2img", "infill"] as const) {
    const s = settings({ width: source.width, height: source.height, imageSource: { ...source, mode, mask: "mask" } });
    assert.equal(await prepareImageInput(s), s);
  }
  assert.equal(draws.length, 0);
  const prepared = await prepareImageInput(settings({ imageSource: { ...source, mask: "dormant mask" } }));
  assert.equal(prepared.imageSource?.mask, "dormant mask");
  assert.equal(draws.length, 1);
});

test("infill still resizes the base and mask together and rejects a missing mask", async t => {
  const draws = mockCanvas(t);
  const imageSource = { ...source, mode: "infill" as const, mask: "data:image/png;base64,bWFzaw==" };
  const prepared = await prepareImageInput(settings({ imageSource }));
  assert.deepEqual(draws, [source.dataUrl, imageSource.mask].map(src => ({ src, width: 1024, height: 1024 })));
  assert.deepEqual([prepared.imageSource?.width, prepared.imageSource?.height], [1024, 1024]);
  assert.equal(imageSource.mask, "data:image/png;base64,bWFzaw==");
  await assert.rejects(prepareImageInput(settings({ imageSource: { ...imageSource, mask: undefined } })), /mask/);
  assert.equal(draws.length, 2);
});

test("canceling Image2Image preparation during decoding prevents resizing and network I/O", async t => {
  const controller = new AbortController();
  const draws = mockCanvas(t, () => controller.abort());
  await assert.rejects(prepareImageInput(settings(), controller.signal), { name: "AbortError" });
  assert.equal(draws.length, 0);
});

test("client submits resized Image2Image bytes for streaming and regular generation across models", async t => {
  const draws = mockCanvas(t);
  const calls: { action: string; parameters: Record<string, unknown> }[] = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)); calls.push(payload);
    if (payload.parameters.stream) {
      const event = encode({ event_type: "final", samp_ix: 0, step_ix: 28, image: png });
      const framed = new Uint8Array(4 + event.length);
      new DataView(framed.buffer).setUint32(0, event.length); framed.set(event, 4);
      return new Response(framed, { headers: { "content-type": "application/x-msgpack" } });
    }
    return Response.json({ images: [{ image: btoa(String.fromCharCode(...png)) }] });
  });
  const client = new NaiClient({ host: "https://example.invalid", token: "test", maxRetries: 0, baseDelay: 0 });
  for (const model of [V5_FULL, Model.V4_5, Model.V3] as const) for (const preview of [true, false]) {
    const s = settings({ model, seed: 42 });
    const handle = await client.generate(s, preview);
    let finals = 0;
    for await (const event of handle.events) if (event.event_type === "final") finals++;
    assert.equal(finals, 1);
    const payload = calls.at(-1)!;
    assert.equal(payload.action, "img2img");
    assert.deepEqual([payload.parameters.width, payload.parameters.height], [1024, 1024]);
    assert.equal(payload.parameters.image, btoa("1024x1024"));
    assert.equal(payload.parameters.strength, source.strength);
    assert.equal(payload.parameters.noise, source.noise);
    assert.equal(payload.parameters.extra_noise_seed, 41);
    assert.equal(payload.parameters.mask, undefined);
    assert.deepEqual(s.imageSource, source);
  }
  assert.equal(calls.length, 6); assert.equal(draws.length, 6);
});
