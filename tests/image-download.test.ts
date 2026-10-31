import test from "node:test";
import assert from "node:assert/strict";
import { downloadDataUrl, imageDownloadFilename } from "../lib/image-actions";
import { loadGenerationPreferences, saveGenerationPreferences } from "../lib/nai/cost";

test("time names use local date and remain distinct within the same millisecond", () => {
  const now = new Date(2026, 9, 31, 9, 8, 7, 6);
  const first = imageDownloadFilename("download.png", now);
  assert.match(first, /^sakura_2026-10-31_09-08-07-006_\d+\.png$/);
  assert.notEqual(first, imageDownloadFilename("download.png", now));
  assert.match(imageDownloadFilename("photo.webp", now), /\.webp$/);
});

test("Blob downloads preserve original bytes and metadata and defer URL cleanup", async t => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
  let blob: Blob | undefined;
  let attached = false;
  let cleanup: (() => void) | undefined;
  const anchor = { href: "", download: "", click() { assert.equal(attached, true); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => anchor,
    body: { appendChild: () => { attached = true; }, removeChild: () => { attached = false; } },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  t.mock.method(URL, "createObjectURL", (value: Blob) => { blob = value; return "blob:test"; });
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(globalThis, "setTimeout", ((callback: () => void) => { cleanup = callback; return 0; }) as unknown as typeof setTimeout);
  downloadDataUrl(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, "download.png");
  assert.equal(anchor.href, "blob:test");
  assert.match(anchor.download, /^sakura_.*\.png$/);
  assert.equal(blob?.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), bytes);
  assert.equal(attached, false);
  assert.equal(revoke.mock.calls.length, 0);
  cleanup!();
  assert.equal(revoke.mock.calls.length, 1);
});

test("automatic downloads default off for old preferences and persist opt-in", t => {
  let value = '{}';
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => value, setItem: (_key: string, next: string) => { value = next; },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  assert.equal(loadGenerationPreferences().autoDownload, false);
  saveGenerationPreferences({ ...loadGenerationPreferences(), autoDownload: true });
  assert.equal(loadGenerationPreferences().autoDownload, true);
});
