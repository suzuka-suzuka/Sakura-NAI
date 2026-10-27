import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { encode } from "@msgpack/msgpack";
import { abortReason, createAbortScope, throwIfAborted } from "../lib/nai/abort";
import { NaiTransport } from "../lib/nai/transport";
import { NaiClient } from "../lib/nai/client";
import { queryAccount } from "../lib/nai/account";
import { prepareImageInput } from "../lib/nai/image-input";
import { prepareFocusedInpainting } from "../lib/nai/focused-inpainting";
import { DEFAULT_SETTINGS, type GenerationSettings } from "../lib/nai/types";
import { Model } from "../lib/nai/protocol";
import { V5_FULL } from "../lib/nai/models";

const cfg = { host: "https://example.invalid", token: "test-token", maxRetries: 3, baseDelay: 1000 };
const settings: GenerationSettings = { ...DEFAULT_SETTINGS, model: V5_FULL, prompt: "cat" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const subscription = { tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 150, purchasedTrainingSteps: 25 } };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const collect = async <T>(events: AsyncIterable<T>) => { const result: T[] = []; for await (const event of events) result.push(event); return result; };
const frame = (event_type: string) => {
  const bytes = encode({ event_type, samp_ix: 0, step_ix: 1, image: png });
  const result = new Uint8Array(4 + bytes.length);
  new DataView(result.buffer).setUint32(0, bytes.length);
  result.set(bytes, 4);
  return result;
};

function without(t: TestContext, object: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); });
}

beforeEach(context => {
  const t = context as TestContext;
  without(t, AbortSignal, "any");
  without(t, AbortSignal, "timeout");
  without(t, AbortSignal.prototype, "throwIfAborted");
  t.mock.timers.enable({ apis: ["setTimeout"] });
});

function pendingBody(signal: AbortSignal, type: string, firstChunk?: Uint8Array) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstChunk) controller.enqueue(firstChunk);
      signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    },
  }), { headers: { "content-type": type } });
}

test("旧浏览器缺少 AbortSignal 新接口时，普通及流式生成均成功", async t => {
  t.mock.method(globalThis, "fetch", async (url: string) => url.endsWith("-stream")
    ? new Response(frame("final"), { headers: { "content-type": "application/x-msgpack" } })
    : Response.json({ images: [{ image: "iVBORw0KGgo=" }] }));
  const client = new NaiClient(cfg);
  for (const streaming of [false, true]) {
    const events = await collect((await client.generate(settings, streaming)).events);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "final");
  }
});

test("旧浏览器账户查询、标签建议与 Vibe 编码正常，并清理完成请求的计时器", async t => {
  const signals: AbortSignal[] = [];
  const clearTimer = t.mock.method(globalThis, "clearTimeout");
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    signals.push(init.signal!);
    if (url.endsWith("subscription")) return Response.json(subscription);
    if (url.includes("suggest-tags")) return Response.json({ tags: [{ tag: "cat" }] });
    if (url.endsWith("encode-vibe")) return new Response(new Uint8Array([1, 2, 3]));
    return new Response(frame("final"), { headers: { "content-type": "application/x-msgpack" } });
  });
  assert.equal((await queryAccount(cfg)).anlas, 175);
  const client = new NaiClient(cfg);
  assert.deepEqual(await client.suggestTags("cat"), [{ tag: "cat" }]);
  const events = await collect((await client.generate({ ...settings, model: Model.V4_5,
    vibe: [{ base64: "source", preview: "", strength: 0.6, informationExtracted: 0.7 }],
  })).events);
  assert.equal(events.length, 1);
  assert.equal(signals.length, 4);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(clearTimer.mock.calls.length, 4);
});

test("已经取消的生成和图生图准备会在网络及图片解码前退出", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new NaiTransport(cfg).images("/ai/generate-image", {}, controller.signal), { name: "AbortError" });
  await assert.rejects(prepareImageInput(settings, controller.signal), { name: "AbortError" });
  await assert.rejects(prepareFocusedInpainting({ ...settings, imageSource: {
    mode: "infill", focused: true, dataUrl: "unused", width: 64, height: 64, strength: 1, noise: 0, inpaintStrength: 1,
  } }, controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.calls.length, 0);
});

test("等待响应头时取消生成会中止 fetch，且不自动重试", async t => {
  const fetch = t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(abortReason(init.signal!)), { once: true });
  }));
  const client = new NaiClient(cfg);
  const handle = await client.generate(settings);
  const pending = assert.rejects(handle.events.next(), { name: "AbortError" });
  await flush();
  client.cancelGeneration();
  await pending;
  assert.equal(fetch.mock.calls.length, 1);
});

test("流式预览到达后取消仍中止下载", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) =>
    pendingBody(init.signal!, "application/x-msgpack", frame("intermediate")));
  const client = new NaiClient(cfg);
  const handle = await client.generate(settings);
  assert.equal((await handle.events.next()).value?.event_type, "intermediate");
  client.cancelGeneration();
  await assert.rejects(handle.events.next(), { name: "AbortError" });
});

for (const streaming of [false, true]) {
  test(`${streaming ? "流式" : "普通"}生成收到响应头后仍受 120 秒超时保护`, async t => {
    const fetch = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) =>
      pendingBody(init.signal!, streaming ? "application/x-msgpack" : "image/png"));
    const client = new NaiClient(cfg);
    const handle = await client.generate(settings, streaming);
    const pending = assert.rejects(handle.events.next(), { name: "TimeoutError" });
    await flush();
    t.mock.timers.tick(119999);
    assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, false);
    t.mock.timers.tick(1);
    await pending;
    assert.equal(fetch.mock.calls.length, 1);
  });
}

test("账户响应体未完成时，8 秒超时仍生效", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => pendingBody(init.signal!, "application/json"));
  const pending = assert.rejects(queryAccount(cfg), /Connection timed out/);
  await flush();
  t.mock.timers.tick(8000);
  await pending;
});

test("429 退避期间可以取消，取消后不会补发请求", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("busy", { status: 429, headers: { "retry-after": "60" } }));
  const controller = new AbortController();
  const pending = assert.rejects(new NaiTransport(cfg).images("/ai/generate-image", {}, controller.signal), { name: "AbortError" });
  await flush();
  controller.abort();
  await pending;
  t.mock.timers.tick(120000);
  assert.equal(fetch.mock.calls.length, 1);
});

test("429 后仍可按原规则重试成功", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("busy", { status: 429 })
    : Response.json({ images: [{ image: "iVBORw0KGgo=" }] }));
  const pending = new NaiTransport(cfg).images("/ai/generate-image", {});
  await flush();
  t.mock.timers.tick(1000);
  assert.equal((await pending).length, 1);
  assert.equal(calls, 2);
});

test("退出流式迭代时关闭下载、移除上游监听并清理超时", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(frame("intermediate")); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/x-msgpack" } }));
  const parent = new AbortController();
  const remove = t.mock.method(parent.signal, "removeEventListener");
  const clearTimer = t.mock.method(globalThis, "clearTimeout");
  const { buildPayload } = await import("../lib/nai/payload");
  for await (const event of new NaiTransport(cfg).generate(buildPayload(settings, 1), true, parent.signal)) {
    assert.equal(event.event_type, "intermediate");
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(remove.mock.calls.length, 1);
  assert.equal(clearTimer.mock.calls.length, 1);
  assert.equal(parent.signal.aborted, false);
});

test("缺少 signal.reason 的旧浏览器仍区分超时，且保持首个取消原因", async t => {
  without(t, AbortSignal.prototype, "reason");
  const originalAbort = AbortController.prototype.abort;
  t.mock.method(AbortController.prototype, "abort", function (this: AbortController) { originalAbort.call(this); });
  const parent = new AbortController();
  const scope = createAbortScope([parent.signal], 100);
  t.mock.timers.tick(100);
  assert.throws(() => throwIfAborted(scope.signal), { name: "TimeoutError" });
  parent.abort(); scope.dispose();
  assert.throws(() => throwIfAborted(scope.signal), { name: "TimeoutError" });
  const aborted = new AbortController(); aborted.abort();
  assert.throws(() => throwIfAborted(aborted.signal), { name: "AbortError" });
});

test("网络失败不自动重放生成，且释放取消监听", async t => {
  const parent = new AbortController();
  const remove = t.mock.method(parent.signal, "removeEventListener");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(new NaiTransport(cfg).images("/ai/generate-image", {}, parent.signal), /Failed to fetch/);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(remove.mock.calls.length, 1);
});
