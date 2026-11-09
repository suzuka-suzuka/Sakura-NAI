import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { ZipWriter } from "@zip.js/zip.js";
import { DEFAULT_SETTINGS } from "../lib/nai/types";
import type { GalleryImage } from "../lib/db/gallery";
import { writeGalleryZip, writeGalleryParts } from "../lib/gallery-export";

const picture = (filename: string, data = "image bytes"): GalleryImage => ({ filename, dataUrl: `data:image/png;base64,${Buffer.from(data).toString("base64")}`, timestamp: new Date().toISOString(), seed: 1, settings: DEFAULT_SETTINGS, batchId: 1, batchIndex: 0, batchSize: 1 });
async function* source(...images: GalleryImage[]) { yield* images; }
const options = () => ({ signal: new AbortController().signal, onProgress: (_count: number) => {} });

test("stream export preserves bytes, duplicate filenames and ZIP64 directory records", async () => {
  const chunks: Uint8Array[] = [];
  let closed = false;
  const sink = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice()); }, close() { closed = true; } });
  const progress: number[] = [];
  await writeGalleryZip(source(picture("中文.png", "one"), picture("中文.png", "two"), picture("../photo.png", "three")), sink, { ...options(), onProgress: count => progress.push(count) });
  assert.equal(closed, true);
  assert.deepEqual(progress, [1, 2, 3]);
  const data = Buffer.concat(chunks);
  assert.ok(data.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), "ZIP64 end record");
  const archive = await JSZip.loadAsync(data, { checkCRC32: true });
  assert.equal(await archive.file("中文.png")!.async("string"), "one");
  assert.equal(await archive.file("中文 (2).png")!.async("string"), "two");
  assert.equal(await archive.file("photo.png")!.async("string"), "three");
});

test("slow disk applies backpressure before the next image is read", async () => {
  let read = 0;
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const firstWrite = new Promise<void>(resolve => { started = resolve; });
  async function* images() {
    read++; yield picture("one.png", "x".repeat(200_000));
    read++; yield picture("two.png");
  }
  let first = true;
  const sink = new WritableStream<Uint8Array>({ async write() { if (first) { first = false; started(); await blocked; } } });
  const pending = writeGalleryZip(images(), sink, options());
  await firstWrite;
  assert.equal(read, 1);
  release();
  await pending;
  assert.equal(read, 2);
});

test("cancel aborts the destination and does not commit a completed file", async () => {
  const controller = new AbortController();
  let aborted = false, closed = false;
  const sink = new WritableStream<Uint8Array>({ write() {}, abort() { aborted = true; }, close() { closed = true; } });
  await assert.rejects(writeGalleryZip(source(picture("one.png"), picture("two.png")), sink, {
    signal: controller.signal, onProgress: () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test("disk failures preserve the original error and stop reading", async () => {
  const failure = new Error("Disk full");
  let reads = 0;
  async function* images() { reads++; yield picture("one.png"); reads++; yield picture("two.png"); }
  await assert.rejects(writeGalleryZip(images(), new WritableStream({ write() { throw failure; } }), options()), error => error === failure);
  assert.equal(reads, 1);
});

test("fallback emits bounded independent archives and waits for each save", async () => {
  const parts: { blob: Blob; filename: string }[] = [];
  let progress = 0;
  await writeGalleryParts(source(picture("same.png", "a".repeat(500)), picture("same.png", "b".repeat(500)), picture("last.png", "c".repeat(500))), {
    ...options(), partBytes: 2048, onProgress: count => { progress = count; },
    onPart: async (blob, filename) => {
      parts.push({ blob, filename });
      const before = progress;
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(progress, before);
      assert.ok(blob.size <= 2048);
    },
  });
  assert.deepEqual(parts.map(part => part.filename), ["sakura-history-001.zip", "sakura-history-002.zip", "sakura-history-003.zip"]);
  const second = await JSZip.loadAsync(await parts[1].blob.arrayBuffer(), { checkCRC32: true });
  assert.equal(await second.file("same (2).png")!.async("string"), "b".repeat(500));
});

test("fallback rejects an oversized single image before allocating a ZIP", async () => {
  await assert.rejects(writeGalleryParts(source(picture("big.png", "x".repeat(3000))), {
    ...options(), partBytes: 2048, onPart: async () => assert.fail("must not create a large Blob"),
  }), /too large/);
});

test("cancelling during a streamed image aborts the file without closing it", async () => {
  const controller = new AbortController();
  let aborted = false, closed = false, writes = 0;
  const sink = new WritableStream<Uint8Array>({
    write() { if (++writes === 2) controller.abort(); },
    abort() { aborted = true; }, close() { closed = true; },
  });
  await assert.rejects(writeGalleryZip(source(picture("large.png", "x".repeat(500_000))), sink, { signal: controller.signal, onProgress: () => assert.fail("entry is incomplete") }), { name: "AbortError" });
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test("cancelling after a fallback part prevents subsequent downloads", async () => {
  const controller = new AbortController();
  let parts = 0;
  await assert.rejects(writeGalleryParts(source(picture("one.png", "a".repeat(500)), picture("two.png", "b".repeat(500))), {
    signal: controller.signal, partBytes: 2048, onProgress() {}, onPart: async () => { parts++; controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(parts, 1);
});

test("allocation failure retries only the unsaved part at half size and preserves names", async t => {
  const original = ZipWriter.prototype.close;
  let attempts = 0;
  t.mock.method(ZipWriter.prototype, "close", async function(this: ZipWriter<Blob>, ...args: Parameters<typeof original>) {
    if (++attempts === 2) throw new RangeError("Array buffer allocation failed");
    return original.apply(this, args);
  });
  const files: Record<string, string> = {};
  const partNames: string[] = [];
  const progress: number[] = [];
  await writeGalleryParts(source(...Array.from({ length: 6 }, (_, index) => picture("same.png", String(index).repeat(2000)))), {
    ...options(), partBytes: 8192, minPartBytes: 2048, onProgress: count => progress.push(count),
    onPart: async (blob, name) => {
      partNames.push(name);
      const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
      for (const entry of Object.values(zip.files)) {
        assert.equal(files[entry.name], undefined, "saved images must not be repeated");
        files[entry.name] = await entry.async("string");
      }
    },
  });
  assert.equal(attempts, 6); // First pair, failed pair, then four single-image parts.
  assert.equal(partNames.length, 5);
  assert.equal(partNames[4], "sakura-history-005.zip");
  assert.equal(Object.keys(files).length, 6);
  for (let index = 0; index < 6; index++) assert.equal(files[index ? `same (${index + 1}).png` : "same.png"], String(index).repeat(2000));
  assert.equal(progress.at(-1), 6);
});

test("persistent Blob failures exhaust all four sizes then preserve the original error", async t => {
  const failure = new Error("Failed to construct 'Blob': out of memory");
  let attempts = 0;
  t.mock.method(ZipWriter.prototype, "close", async () => { attempts++; throw failure; });
  await assert.rejects(writeGalleryParts(source(picture("one.png")), {
    ...options(), partBytes: 16384, minPartBytes: 2048, onPart: async () => assert.fail("no download on failure"),
  }), error => error === failure);
  assert.equal(attempts, 4);
});

test("entry allocation failures can also recover before ZIP finalization", async t => {
  const original = ZipWriter.prototype.add;
  let attempts = 0;
  t.mock.method(ZipWriter.prototype, "add", async function(this: ZipWriter<Blob>, ...args: Parameters<typeof original>) {
    if (++attempts === 1) throw new RangeError("Invalid typed array length");
    return original.apply(this, args);
  });
  let parts = 0;
  await writeGalleryParts(source(picture("one.png")), {
    ...options(), partBytes: 8192, minPartBytes: 2048,
    onPart: async blob => {
      parts++;
      const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
      assert.equal(await zip.file("one.png")!.async("string"), "image bytes");
    },
  });
  assert.equal(attempts, 2);
  assert.equal(parts, 1);
});

test("non-allocation ZIP errors and download errors never trigger retries", async t => {
  const failure = new Error("Permission denied");
  const close = t.mock.method(ZipWriter.prototype, "close", async () => { throw failure; });
  await assert.rejects(writeGalleryParts(source(picture("one.png")), { ...options(), onPart: async () => {} }), error => error === failure);
  assert.equal(close.mock.calls.length, 1);
  close.mock.restore();
  let downloads = 0;
  const downloadFailure = new Error("out of memory");
  await assert.rejects(writeGalleryParts(source(picture("one.png")), {
    ...options(), onPart: async () => { downloads++; throw downloadFailure; },
  }), error => error === downloadFailure);
  assert.equal(downloads, 1);
});
