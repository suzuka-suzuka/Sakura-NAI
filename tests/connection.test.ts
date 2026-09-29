import test, { beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { useStore } from "../lib/store";
import { loadConnection, saveConnection, NaiClient } from "../lib/nai/client";
import { queryAccount, AccountQueryError } from "../lib/nai/account";
import { Host } from "../lib/nai/protocol";

const cfg = { host: "https://relay.example.test/nai/", token: "skr_test-only-token", maxRetries: 3, baseDelay: 2000 };
const subscription = { tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 150, purchasedTrainingSteps: 25 }, usage: { percent: 70, isNegative: false } };
const success = () => Response.json(subscription);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
let storageDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  const values = new Map<string, string>();
  storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
});
afterEach(() => {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function mockQuery(t: TestContext, handler: () => Promise<Response>) {
  return t.mock.method(globalThis, "fetch", handler);
}

test("自定义地址真实请求账户，验证和额度加载共用一次请求", async t => {
  const pending = deferred<Response>();
  const request = t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(url, "https://relay.example.test/nai/user/subscription");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${cfg.token}`);
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(options?.cache, "no-store"); assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    return pending.promise;
  });
  useStore.setState({ showConnect: true });
  const connecting = useStore.getState().connect(cfg);
  assert.equal(useStore.getState().connectionStatus, "verifying");
  assert.equal(useStore.getState().account, null);
  pending.resolve(success());
  assert.equal(await connecting, true);
  assert.equal(request.mock.calls.length, 1);
  assert.equal(useStore.getState().connectionStatus, "ok");
  assert.equal(useStore.getState().account?.anlas, 175);
  assert.equal(useStore.getState().account?.usage?.percent, 70);
  assert.equal(useStore.getState().showConnect, false);
  assert.equal(loadConnection()?.token, cfg.token);
});

test("官方地址同样只查询一次账户，不重复验证", async t => {
  const request = t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, `${Host.WEB}/user/subscription`); return success();
  });
  assert.equal(await useStore.getState().connect({ ...cfg, host: Host.WEB }), true);
  assert.equal(request.mock.calls.length, 1);
});

test("401 拒绝密钥，不保存错误凭据、不发起生成且结束加载状态", async t => {
  const request = mockQuery(t, async () => new Response("not logged", { status: 401 }));
  assert.equal(await useStore.getState().connect(cfg), false);
  const state = useStore.getState();
  assert.equal(state.connectionStatus, "invalid"); assert.equal(state.client, null);
  assert.equal(state.accountLoading, false); assert.equal(state.account, null);
  assert.equal(state.showConnect, true); assert.equal(loadConnection(), null);
  assert.match(state.connectionError!, /invalid or disabled/);
  await state.generate(); assert.equal(request.mock.calls.length, 1);
});

test("权限、接口不支持、限流与服务异常保持未验证，不误判为坏密钥或重试", async t => {
  for (const [status, message] of [[403, /forbidden/], [404, /does not support/], [405, /does not support/], [429, /busy/], [500, /unavailable/], [501, /does not support/], [503, /unavailable/]] as const) {
    const request = mockQuery(t, async () => new Response("private upstream detail", { status }));
    useStore.setState({ showConnect: true });
    assert.equal(await useStore.getState().connect(cfg), false);
    const state = useStore.getState();
    assert.equal(state.connectionStatus, "unknown"); assert.ok(state.client);
    assert.equal(state.account, null); assert.equal(state.showConnect, true);
    assert.match(state.connectionError!, message); assert.ok(!state.connectionError!.includes("private upstream"));
    assert.equal(loadConnection()?.token, cfg.token); assert.equal(request.mock.calls.length, 1);
    request.mock.restore();
  }
});

test("网络失败和超时保留配置并显示各自原因", async t => {
  for (const [error, message] of [[new TypeError("Failed to fetch"), /Cannot reach/], [new DOMException("timeout", "TimeoutError"), /timed out/]] as const) {
    const request = mockQuery(t, async () => { throw error; });
    assert.equal(await useStore.getState().connect(cfg), false);
    assert.equal(useStore.getState().connectionStatus, "unknown");
    assert.match(useStore.getState().connectionError!, message);
    assert.equal(loadConnection()?.token, cfg.token);
    request.mock.restore();
  }
});

test("200 HTML、错误 JSON 和无效账户数据不会冒充验证成功", async t => {
  for (const body of ["<html>proxy homepage</html>", "{", JSON.stringify({ ok: true }), JSON.stringify({ tier: "3", active: true })]) {
    const request = mockQuery(t, async () => new Response(body, { status: 200 }));
    assert.equal(await useStore.getState().connect(cfg), false);
    assert.equal(useStore.getState().connectionStatus, "unknown");
    assert.match(useStore.getState().connectionError!, /invalid account data/);
    request.mock.restore();
  }
});

test("非法地址不发请求，自定义路径不会丢失或回退至官方", async t => {
  const request = mockQuery(t, async () => { throw new Error("must not fetch"); });
  for (const host of ["not a URL", "ftp://relay.test", "https://user:pass@relay.test", "https://relay.test?a=b", "https://relay.test/#fragment"]) {
    await assert.rejects(queryAccount({ ...cfg, host }), AccountQueryError);
  }
  assert.equal(request.mock.calls.length, 0);
});

test("恢复保存的连接先显示验证中，收到有效账户后才连接", async t => {
  saveConnection(cfg);
  const pending = deferred<Response>();
  const request = mockQuery(t, () => pending.promise);
  const initialization = useStore.getState().init();
  assert.equal(useStore.getState().connectionStatus, "verifying");
  pending.resolve(success()); await initialization;
  assert.equal(useStore.getState().connectionStatus, "ok");
  assert.equal(useStore.getState().account?.anlas, 175);
  assert.equal(request.mock.calls.length, 1);
});

test("恢复时失效密钥显示重新连接，保留填写内容供修改", async t => {
  saveConnection(cfg); mockQuery(t, async () => new Response(null, { status: 401 }));
  await useStore.getState().init();
  assert.equal(useStore.getState().connectionStatus, "invalid");
  assert.equal(useStore.getState().client, null); assert.equal(useStore.getState().showConnect, true);
  assert.equal(useStore.getState().connection?.token, cfg.token);
  assert.equal(loadConnection()?.token, cfg.token);
});

test("刷新额度失败同步取消已连接，恢复成功后更新状态和额度", async t => {
  let status = 200;
  mockQuery(t, async () => status === 200 ? success() : new Response(null, { status }));
  await useStore.getState().connect(cfg);
  status = 503; await useStore.getState().refreshAccount();
  assert.equal(useStore.getState().connectionStatus, "unknown"); assert.equal(useStore.getState().account, null);
  status = 200; await useStore.getState().refreshAccount();
  assert.equal(useStore.getState().connectionStatus, "ok"); assert.equal(useStore.getState().connectionError, null);
  status = 401; await useStore.getState().refreshAccount();
  assert.equal(useStore.getState().connectionStatus, "invalid"); assert.equal(useStore.getState().client, null);
});

test("旧请求晚返回不会覆盖新连接或保存旧密钥", async t => {
  const pending = deferred<Response>();
  let calls = 0;
  mockQuery(t, () => ++calls === 1 ? pending.promise : Promise.resolve(success()));
  const old = useStore.getState().connect(cfg);
  const newer = { ...cfg, token: "skr_new-test-token", host: "https://new.example.test" };
  assert.equal(await useStore.getState().connect(newer), true);
  pending.resolve(new Response(null, { status: 401 }));
  assert.equal(await old, false);
  assert.equal(useStore.getState().connectionStatus, "ok");
  assert.equal(loadConnection()?.token, newer.token);
  assert.equal(useStore.getState().connection?.host, newer.host);
});

test("验证中断开连接，晚到响应不会恢复登录或存回凭据", async t => {
  const pending = deferred<Response>(); mockQuery(t, () => pending.promise);
  const connecting = useStore.getState().connect(cfg);
  useStore.getState().disconnect(); pending.resolve(success());
  assert.equal(await connecting, false);
  assert.equal(useStore.getState().connectionStatus, "idle"); assert.equal(useStore.getState().accountLoading, false);
  assert.equal(useStore.getState().client, null); assert.equal(loadConnection(), null);
});

test("进行中的生成遇到账户鉴权失败只标记状态，不中断既有客户端", async t => {
  const client = new NaiClient(cfg);
  mockQuery(t, async () => new Response(null, { status: 401 }));
  useStore.setState({ client, connection: cfg, connectionStatus: "ok", isGenerating: true });
  await useStore.getState().refreshAccount();
  assert.equal(useStore.getState().connectionStatus, "invalid");
  assert.equal(useStore.getState().client, client); assert.equal(useStore.getState().isGenerating, true);
  assert.equal(useStore.getState().showConnect, false);
  useStore.setState({ isGenerating: false });
  await useStore.getState().runDirector("lineArt", {});
  assert.equal(useStore.getState().showConnect, true);
});
