import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "@msgpack/msgpack";
import JSZip from "jszip";
import { gzipSync, zlibSync } from "fflate";
import { buildPayload } from "../lib/nai/payload";
import { v5Prompt } from "../lib/nai/v5";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { V5_FULL, V5_CURATED } from "../lib/nai/models";
import { Model, Sampler, Image, EventType } from "../lib/nai/protocol";
import { decodeStream, decodeImages, NaiTransport } from "../lib/nai/transport";
import { extractImageMetadata } from "../lib/nai/media";
import { recipeFromNovelAIMetadata } from "../lib/nai/import-recipe";
import { NaiClient } from "../lib/nai/client";

const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({ ...DEFAULT_SETTINGS, model: V5_FULL, prompt: "1girl", ...patch });
const char = (uc = "") => ({ prompt: 'girl holding "Hello"', uc, enabled: true, center: { x: 0.123, y: 0.789 } });
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
const conn = { host: "https://example.invalid", token: "test-token", maxRetries: 0, baseDelay: 0 };
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n,p) => n + p.length, 0));
  let i = 0; for (const p of parts) { result.set(p,i); i += p.length; } return result;
};
const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,v); return b; };
const utf = (s: string) => new TextEncoder().encode(s);
const frame = (event: unknown) => { const bytes = encode(event); return concat(u32(bytes.length), bytes); };
const final = (index = 0) => ({ event_type: "final", samp_ix: index, step_ix: 28, image: png });
const collect = async <T>(items: AsyncIterable<T>) => { const result: T[] = []; for await (const i of items) result.push(i); return result; };
const streamed = (bytes: Uint8Array, type = "application/x-msgpack", chunk = 3) => new Response(new ReadableStream({
  start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i,i + chunk)); c.close(); },
}), { headers: { "content-type": type } });

test("V5 full/curated: complete captions, empty UCs, free coordinates, capability stripping", () => {
  for (const model of [V5_FULL, V5_CURATED] as const) {
    const payload = buildPayload(settings({ model, characters: [char()], autoSmea: true, dynamicThresholding: true, sampler: Sampler.DDIM, transparentBackground: true }), 123);
    const p = payload.parameters;
    assert.equal(p.params_version, 4); assert.equal(p.seed, 123); assert.equal(p.sampler, Sampler.EULER_ANC);
    assert.equal(p.noise_schedule, "karras"); assert.equal(p.dynamic_thresholding, false);
    assert.equal(p.straight_alpha, true); assert.equal(p.tag_hint_transparent_background, true);
    assert.equal(p.sm, undefined); assert.equal(p.reference_image_multiple, undefined);
    assert.match(payload.input, /teXt: Hello$/);
    const negative = p.v4_negative_prompt as { caption: { char_captions: { char_caption: string; centers: { x: number; y: number }[] }[] } };
    assert.deepEqual(negative.caption.char_captions, [{ char_caption: "", centers: [{ x: 0.123, y: 0.789 }] }]);
  }
});
test("V5 auto text respects manual text and disabled auto text, preserves repeated prompt tags", () => {
  assert.equal(v5Prompt(settings({ prompt: "Text: hello", qualityPreset: "standard" })), "very aesthetic, masterpiece, no text, Text: hello");
  assert.equal(v5Prompt(settings({ prompt: "cat, cat", qualityToggle: false })), "cat, cat");
  assert.equal(v5Prompt(settings({ prompt: 'sign "Hi"', autoText: false, qualityToggle: false })), 'sign "Hi"');
  assert.equal(v5Prompt(settings({ prompt: "cat, Text: Hello", characters: [char()], qualityPreset: "standard" })), "cat, very aesthetic, masterpiece, no text, Text: Hello");
});
test("V5 validates pixel cap, batch limit, character count and coordinates before network I/O", () => {
  assert.throws(() => buildPayload(settings({ width: 2048, height: 2048 }), 1), /pixels/);
  assert.throws(() => buildPayload(settings({ nSamples: 5 }), 1), /at most 4/);
  assert.doesNotThrow(() => buildPayload(settings({ width: 512, height: 512, nSamples: 8 }), 1));
  assert.doesNotThrow(() => buildPayload(settings({ characters: Array.from({ length: 22 }, () => char()) }), 1));
  assert.throws(() => buildPayload(settings({ characters: Array.from({ length: 23 }, () => char()) }), 1), /22/);
  assert.throws(() => buildPayload(settings({ characters: [{ ...char(), center: { x: NaN, y: 0.5 } }] }), 1), /coordinates/);
});
test("legacy builders preserve generation settings, V4+ captions and V3 SMEA", () => {
  for (const model of Object.values(Model)) {
    const p = buildPayload(settings({ model, autoSmea: true, scale: 6.2, negativePrompt: "bad shoes" }), 32).parameters;
    assert.equal(p.scale, 6.2); assert.equal(p.seed, 32); assert.match(String(p.negative_prompt), /bad shoes/);
    assert.equal(p.sm, model === Model.V3 || model === Model.FURRY);
    assert.equal(Boolean(p.v4_prompt), model !== Model.V3 && model !== Model.FURRY);
  }
});
test("MessagePack streams survive split headers/bodies, multiple samples and duplicate finals", async () => {
  const bytes = concat(frame({ ...final(), event_type: "intermediate" }), frame(final(1)), frame(final(1)), frame(final(0)));
  const events = await collect(decodeStream(streamed(bytes), 2));
  assert.deepEqual(events.map(e => e.event_type), ["intermediate", "final", "final"]);
  assert.equal(events[0].image.toDataURL(), new Image(png).toDataURL());
});
test("SSE handles CRLF boundaries, trailing record and base64", async () => {
  const value = JSON.stringify({ ...final(), image: btoa(String.fromCharCode(...png)) });
  const events = await collect(decodeStream(streamed(utf(`: keepalive\r\n\r\nevent: final\r\ndata: ${value}`), "text/event-stream", 1), 1));
  assert.equal(events.length, 1); assert.equal(events[0].event_type, EventType.FINAL);
});
test("stream failures reject instead of reporting partial results as success", async () => {
  await assert.rejects(collect(decodeStream(streamed(frame(final(0))), 2)), /before all final/);
  await assert.rejects(collect(decodeStream(streamed(frame(final()).slice(0,-2)), 1)), /Truncated/);
  await assert.rejects(collect(decodeStream(streamed(frame({ event_type: "error", message: "quota" })), 1)), /quota/);
  await assert.rejects(collect(decodeStream(streamed(frame(final(5))), 1)), /invalid image index/);
  await assert.rejects(collect(decodeStream(streamed(utf("event: error\ndata: quota\n\n"), "text/event-stream"), 1)), /quota/);
});
test("ZIP and JSON image responses are decoded in sample order; empty archives fail", async () => {
  const zip = new JSZip(); zip.file("image_10.png", png); zip.file("image_2.png", png); zip.file("meta.txt", "hi");
  assert.equal((await decodeImages(new Response(new Uint8Array(await zip.generateAsync({ type: "uint8array" }))))).length, 2);
  assert.equal((await decodeImages(Response.json({ images: [{ index: 0, image: btoa(String.fromCharCode(...png)) }] }))).length, 1);
  await assert.rejects(decodeImages(new Response(new Uint8Array(await new JSZip().generateAsync({ type: "uint8array" })))), /No images/);
});
test("request transport uses configured auth/host and never replays ambiguous 500 failures", async (t) => {
  const calls: [string, RequestInit | undefined][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response("error test-token", { status: 500 }); });
  await assert.rejects(new NaiTransport({ ...conn, maxRetries: 3 }).request("/ai/generate-image", {}), /\[redacted\]/);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "https://example.invalid/ai/generate-image");
  assert.equal((calls[0][1]?.headers as Record<string,string>).Authorization, "Bearer test-token");
});
test("client encodes V4 vibes once per model/image/extraction and sends cached encoding", async (t) => {
  const bodies: { path: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    bodies.push({ path: url, body: JSON.parse(String(init.body)) });
    return url.endsWith("encode-vibe") ? new Response(new Uint8Array([1,2,3])) : streamed(frame(final()));
  });
  const client = new NaiClient(conn);
  const s = settings({ model: Model.V4_5, vibe: [{ base64: "source", preview: "", strength: 0.6, informationExtracted: 0.7 }] });
  for (let i = 0; i < 2; i++) await collect((await client.generate(s)).events);
  assert.equal(bodies.filter(c => c.path.endsWith("encode-vibe")).length, 1);
  assert.deepEqual((bodies[1].body.parameters as Record<string,unknown>).reference_image_multiple, ["AQID"]);
});
test("client V5 never encodes dormant references; cancel aborts request and releases reader", async (t) => {
  let calls = 0, cancelled = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(frame({ ...final(), event_type: "intermediate" }));
      init.signal?.addEventListener("abort", () => { cancelled = true; c.error(new Error("aborted")); });
    } }), { headers: { "content-type": "application/x-msgpack" } });
  });
  const client = new NaiClient(conn);
  const handle = await client.generate(settings({ vibe: [{ base64: "unused", preview: "", strength: 1, informationExtracted: 1 }] }));
  await handle.events.next(); client.cancelGeneration();
  await assert.rejects(handle.events.next(), /aborted/);
  assert.equal(calls, 1); assert.equal(cancelled, true);
});

test("Director tools, upscale and Enhance construct independent official API requests", async (t) => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { document: globals.document, createImageBitmap: globals.createImageBitmap };
  globals.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {} }), toDataURL: () => new Image(png).toDataURL() }) };
  globals.createImageBitmap = async () => ({ width: 832, height: 1216, close() {} });
  t.after(() => { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete globals[k]; else globals[k] = v; } });
  const calls: { url: string; body: Record<string,unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body instanceof FormData ? JSON.parse(await (init.body.get("request") as Blob).text()) : JSON.parse(String(init.body)) });
    return Response.json({ images: [{ image: btoa(String.fromCharCode(...png)) }] });
  });
  const client = new NaiClient(conn), blob = new Blob([png]);
  await client.lineArt(blob); await client.sketch(blob); await client.backgroundRemoval(blob); await client.declutter(blob);
  await client.colorize(blob, "blue", 2); await client.changeEmotion(blob, undefined, "smile", 3);
  await client.upscale(blob); await client.enhance(blob, settings({ seed: 999 }));
  assert.deepEqual(calls.slice(0,6).map(c => c.body.req_type), ["lineart", "sketch", "bg-removal", "declutter", "colorize", "emotion"]);
  assert.equal(calls[4].body.defry, 2); assert.equal(calls[5].body.prompt, "neutral;;smile");
  assert.match(calls[6].url, /\/ai\/upscale$/); assert.equal(calls[6].body.model, V5_CURATED); assert.equal(calls[6].body.declared_blur_sigma, 0);
  assert.equal(calls[7].body.model, V5_FULL); assert.equal(calls[7].body.action, "img2img");
  const p = calls[7].body.parameters as Record<string,unknown>;
  assert.equal(p.seed, 999); assert.equal(p.width, 832); assert.equal(p.strength, 0.2); assert.equal(p.stream, undefined);
});

const chunk = (kind: string, data: Uint8Array) => concat(u32(data.length), utf(kind), data, u32(0));
const ihdr = (w: number, h: number) => chunk("IHDR", concat(u32(w),u32(h),new Uint8Array([8,6,0,0,0])));
test("PNG text/zTXt/iTXt import and V5 recipe restore continuous coordinates and transparency", async () => {
  const comment = JSON.stringify({ model: V5_FULL, prompt: "cat", steps: 28, seed: 42, tag_hint_transparent_background: true, use_coords: false,
    v4_prompt: { caption: { char_captions: [{ char_caption: "girl", centers: [{ x: 0.123, y: 0.789 }] }] } } });
  for (const entry of [chunk("tEXt", concat(utf("Comment\0"),utf(comment))), chunk("zTXt",concat(utf("Comment\0\0"),zlibSync(utf(comment)))), chunk("iTXt",concat(utf("Comment\0\0\0\0\0"),utf(comment)))]) {
    const meta = await extractImageMetadata(new Blob([concat(png,ihdr(832,1216),entry,chunk("IEND",new Uint8Array()))]));
    assert.equal(meta.type,"NOVELAI");
    const recipe = recipeFromNovelAIMetadata(meta.entries,{ width:832,height:1216 });
    assert.equal(recipe.settings.model,V5_FULL); assert.equal(recipe.settings.transparentBackground,true);
    assert.equal(recipe.settings.useCoords,false); assert.equal(recipe.settings.characters[0].center.x,0.123);
    assert.equal(recipe.settings.qualityToggle,false);
  }
});
test("PNG stealth alpha metadata decodes column-major bits without canvas", async () => {
  const info = gzipSync(utf(JSON.stringify({ Software: "NovelAI", Comment: JSON.stringify({ prompt: "cat", steps: 28 }) })));
  const payload = concat(utf("stealth_pngcomp"),u32(info.length * 8),info);
  const w = 64, h = 64, pixels = new Uint8Array(h * (w * 4 + 1));
  for (let i = 0; i < payload.length * 8; i++) {
    const x = Math.floor(i / h), y = i % h;
    pixels[y * (w * 4 + 1) + 1 + x * 4 + 3] = (payload[Math.floor(i / 8)] >> (7 - i % 8)) & 1;
  }
  const bytes = concat(png,ihdr(w,h),chunk("IDAT",zlibSync(pixels)),chunk("IEND",new Uint8Array()));
  const metadata = await extractImageMetadata(new Blob([bytes]));
  assert.equal(metadata.type,"NOVELAI"); assert.match(metadata.entries.find(e => e.keyword === "Comment")!.text,/cat/);
});
