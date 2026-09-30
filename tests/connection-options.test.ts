import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionSource, createConnectionDraft, connectionFromDraft } from "../lib/connection-options";
import { loadConnectionOptions, parseConnectionOptions } from "../lib/server/connection-config";
import { DEFAULT_CONNECTION } from "../lib/nai/client";
import { queryAccount } from "../lib/nai/account";

const options = { sakuraUrl: "https://relay.tenshimomone.com/" };
const retry = { maxRetries: 3, baseDelay: 2000 };

test("配置只发布 Sakura 地址，拒绝非法地址并保留接口路径", () => {
  assert.deepEqual(parseConnectionOptions({ sakura: { url: " https://relay.example.test/nai/ ", token: "private" }, password: "private" }), { sakuraUrl: "https://relay.example.test/nai/" });
  for (const value of [null, {}, { sakura: { url: "" } }, { sakura: { url: 12 } }, ...["invalid", "ftp://relay.test", "https://user:pass@relay.test", "https://relay.test?key=private", "https://relay.test/#fragment"].map(url => ({ sakura: { url } }))]) {
    assert.throws(() => parseConnectionOptions(value));
  }
});

test("每次加载重新读取配置文件，文件缺失或错误时禁用 Sakura", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sakura-connection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "connection.config.json");
  t.mock.method(console, "error", () => {});
  await writeFile(path, JSON.stringify({ sakura: { url: options.sakuraUrl } }));
  assert.deepEqual(await loadConnectionOptions(path), options);
  await writeFile(path, JSON.stringify({ sakura: { url: "https://new.example.test/nai/" } }));
  assert.deepEqual(await loadConnectionOptions(path), { sakuraUrl: "https://new.example.test/nai/" });
  await writeFile(path, "{invalid");
  assert.deepEqual(await loadConnectionOptions(path), { sakuraUrl: null });
  assert.deepEqual(await loadConnectionOptions(join(directory, "missing.json")), { sakuraUrl: null });
});

test("恢复旧连接时按地址识别密钥类型，保留自定义接口", () => {
  assert.equal(connectionSource(`${DEFAULT_CONNECTION.host}/`, options), "official");
  assert.equal(connectionSource("https://relay.tenshimomone.com", options), "sakura");
  const saved = { ...retry, host: "https://custom.example.test/nai", token: "custom-test-key" };
  const draft = createConnectionDraft(saved, options);
  assert.equal(draft.source, "custom");
  assert.deepEqual(connectionFromDraft(draft, options, retry), saved);
  assert.equal(connectionSource(options.sakuraUrl, { sakuraUrl: "https://new.example.test" }), "custom");
});

test("官方和 Sakura 表单分开保存密钥，切换不会借用另一个来源的密钥", () => {
  const draft = createConnectionDraft({ ...retry, host: DEFAULT_CONNECTION.host, token: "official-test-key" }, options);
  assert.equal(connectionFromDraft({ ...draft, source: "sakura" }, options, retry).token, "");
  draft.tokens.sakura = " sakura-test-key ";
  assert.deepEqual(connectionFromDraft({ ...draft, source: "sakura" }, options, retry), { ...retry, host: options.sakuraUrl, token: "sakura-test-key" });
  assert.equal(connectionFromDraft(draft, options, retry).token, "official-test-key");
  assert.equal(connectionFromDraft({ ...draft, source: "custom" }, options, retry).token, "");
  assert.equal(connectionFromDraft({ ...draft, source: "sakura" }, { sakuraUrl: null }, retry).host, "");
});

test("恢复 Sakura 连接后切换官方不会发送 Sakura 密钥", () => {
  const draft = createConnectionDraft({ ...retry, host: options.sakuraUrl, token: "sakura-test-key" }, options);
  assert.equal(draft.source, "sakura");
  assert.equal(connectionFromDraft({ ...draft, source: "official" }, options, retry).token, "");
  assert.equal(connectionFromDraft(draft, options, retry).token, "sakura-test-key");
});

test("两种类型验证账户时使用各自地址和密钥", async t => {
  const requests: { url: string; token: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), token: new Headers(init?.headers).get("authorization") });
    return Response.json({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0 } });
  });
  const draft = createConnectionDraft(null, options);
  assert.equal(draft.source, "sakura");
  assert.equal(createConnectionDraft(null, { sakuraUrl: null }).source, "official");
  draft.tokens.official = "official-test-key";
  draft.tokens.sakura = "sakura-test-key";
  await queryAccount(connectionFromDraft(draft, options, retry));
  await queryAccount(connectionFromDraft({ ...draft, source: "official" }, options, retry));
  assert.deepEqual(requests, [
    { url: "https://relay.tenshimomone.com/user/subscription", token: "Bearer sakura-test-key" },
    { url: `${DEFAULT_CONNECTION.host}/user/subscription`, token: "Bearer official-test-key" },
  ]);
});
