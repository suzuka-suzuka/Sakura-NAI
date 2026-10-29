import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../lib/nai/types";
import { saveImages, loadImages, maintainGallery, deleteImage, clearImages, retentionPlan, imageBytes, type GalleryImage } from "../lib/db/gallery";
import { useStore } from "../lib/store";

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
  useStore.setState(useStore.getInitialState(), true);
});
const picture = (batchId: number, batchIndex = 0, batchSize = 1): GalleryImage => ({ dataUrl: "data:image/png;base64,YQ==", timestamp: new Date().toISOString(), filename: `${batchId}-${batchIndex}.png`, seed: 1, settings: DEFAULT_SETTINGS, batchId, batchIndex, batchSize });
async function seed(count: number) {
  return saveImages(Array.from({ length: count }, (_, i) => picture(i)));
}

test("80% warning persists across reloads, resets below threshold, and count limit removes oldest", async () => {
  assert.equal((await seed(159)).report.warn, false);
  assert.equal((await saveImages([picture(159)])).report.warn, true);
  assert.equal((await maintainGallery()).warn, false);
  await deleteImage(1);
  assert.equal((await saveImages([picture(160)])).report.warn, true);
  const result = await saveImages(Array.from({ length: 40 }, (_, i) => picture(161 + i)));
  assert.equal(result.report.count, 199);
  assert.equal(result.report.deleted, 1);
  assert.equal(result.report.ids.includes(2), false);
  await clearImages();
  assert.equal((await maintainGallery()).count, 0);
});

test("capacity retention removes whole oldest batches and includes embedded settings in byte accounting", () => {
  const plan = retentionPlan([{ id: 1, bytes: 20, batchId: 1 }, { id: 2, bytes: 20, batchId: 1 }, { id: 3, bytes: 60, batchId: 2 }], { count: 200, bytes: 100 });
  assert.deepEqual(plan.kept.map(x => x.id), [3]);
  assert.equal(plan.bytes, 60);
  const img = picture(1);
  assert.ok(imageBytes({ ...img, settings: { ...img.settings, prompt: "字".repeat(100) } }) > imageBytes(img) + 200);
});

test("pagination preserves batch boundary and is stable when new images arrive", async () => {
  await seed(45);
  await saveImages(Array.from({ length: 6 }, (_, i) => picture(100, i, 6)));
  const first = await loadImages(undefined, 4);
  assert.equal(first.images.length, 6);
  await saveImages([picture(101)]);
  const second = await loadImages(first.next!);
  assert.equal(second.images.length, 40);
  assert.equal(second.images[0].batchId, 44);
  const last = await loadImages(second.next!);
  assert.equal(last.images.length, 5);
  assert.equal(last.next, null);
  assert.equal(new Set([...first.images, ...second.images, ...last.images].map(x => x.id)).size, 51);
});

test("legacy database upgrades without losing history and supplies capacity metadata", async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nyanovel-images", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("images", { keyPath: "id", autoIncrement: true });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction("images", "readwrite");
      tx.objectStore("images").add(picture(1));
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  const report = await maintainGallery();
  assert.equal(report.count, 1);
  assert.ok(report.bytes > 0);
  assert.equal((await loadImages()).images[0].filename, "1-0.png");
});

test("store loads only one page, merges more without duplicates, and clears unloaded records", async () => {
  await seed(95);
  await useStore.getState().loadGallery();
  assert.equal(useStore.getState().images.length, 40);
  assert.equal(useStore.getState().galleryCount, 95);
  await Promise.all([useStore.getState().loadMoreGallery(), useStore.getState().loadMoreGallery()]);
  assert.equal(useStore.getState().images.length, 80);
  await useStore.getState().clearGallery();
  assert.equal((await loadImages()).images.length, 0);
  assert.equal(useStore.getState().galleryNext, null);
});

test("failed transaction rolls back new images and leaves existing history intact", async t => {
  await seed(5);
  const { IDBObjectStore } = await import("fake-indexeddb");
  const original = IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype, "put", function(this: InstanceType<typeof IDBObjectStore>, ...args: Parameters<typeof original>) {
    if (this.name === "gallery-state") this.transaction.abort();
    else return original.apply(this, args);
  });
  await assert.rejects(saveImages([picture(100)]));
  assert.equal((await loadImages()).images.length, 5);
});

test("failed persistence keeps generated result downloadable without rethrowing", async t => {
  t.mock.method(console, "error", () => {});
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  const saved = await useStore.getState().appendGalleryImages([picture(1)]);
  assert.ok(saved[0].id! < 0);
  assert.equal(useStore.getState().images[0].dataUrl, picture(1).dataUrl);
});

test("capacity alone triggers the warning once and pruning even with very few images", async () => {
  await seed(2);
  // Fixture represents large payload sizes without allocating hundreds of MiB in a unit test.
  const setBytes = (bytes: number) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nyanovel-images", 2);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction("image-info", "readwrite");
      tx.objectStore("image-info").put({ id: 1, batchId: 0, bytes });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  await setBytes(400 * 1024 * 1024);
  assert.equal((await maintainGallery()).warn, true);
  assert.equal((await maintainGallery()).warn, false);
  await setBytes(500 * 1024 * 1024);
  const report = await maintainGallery();
  assert.equal(report.deleted, 1);
  assert.equal(report.count, 1);
  assert.equal((await loadImages()).images[0].batchId, 1);
});

test("clearing while a page is loading cannot resurrect deleted history", async () => {
  await seed(95);
  await useStore.getState().loadGallery();
  await Promise.all([useStore.getState().loadMoreGallery(), useStore.getState().clearGallery()]);
  assert.equal(useStore.getState().images.length, 0);
  assert.equal(useStore.getState().galleryNext, null);
  assert.equal(useStore.getState().galleryLoadingMore, false);
});

test("generation before history initialization still exposes older pages and prunes loaded originals", async () => {
  await seed(198);
  await useStore.getState().appendGalleryImages([picture(199)]);
  assert.notEqual(useStore.getState().galleryNext, null);
  await useStore.getState().loadMoreGallery();
  assert.equal(useStore.getState().images.length, 41);
  await useStore.getState().appendGalleryImages([picture(200)]);
  assert.equal(useStore.getState().galleryCount, 199);
  assert.equal(useStore.getState().galleryIds!.includes(1), false);
  assert.equal(useStore.getState().images.some(image => image.id === 1), false);
});
