import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../lib/nai/types";
import { saveImages, loadImages, getGalleryReport, deleteImage, clearImages, type GalleryImage } from "../lib/db/gallery";
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

test("history beyond the former limit remains stored and only explicit deletion removes images", async () => {
  assert.equal((await seed(250)).report.count, 250);
  await useStore.getState().loadGallery();
  assert.equal(useStore.getState().galleryCount, 250);
  assert.equal(useStore.getState().images.length, 40);
  assert.equal((await saveImages([picture(251)])).report.count, 251);
  assert.equal((await loadImages(2)).images[0].id, 1);
  assert.equal((await deleteImage(1)).count, 250);
  await clearImages();
  assert.equal((await getGalleryReport()).count, 0);
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

for (const version of [1, 2]) test(`database v${version} upgrades without deleting image records`, async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nyanovel-images", version);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("images", { keyPath: "id", autoIncrement: true });
      if (version === 2) {
        req.result.createObjectStore("image-info", { keyPath: "id" });
        req.result.createObjectStore("gallery-state");
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction([...db.objectStoreNames], "readwrite");
      for (let i = 1; i <= 220; i++) tx.objectStore("images").add(picture(i));
      if (version === 2) tx.objectStore("image-info").put({ id: 1, batchId: 1, bytes: 600 * 1024 * 1024 });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  await useStore.getState().loadGallery();
  assert.equal((await getGalleryReport()).count, 220);
  assert.equal((await loadImages(2)).images[0].filename, "1-0.png");
  assert.equal(useStore.getState().images.length, 40);
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
  const original = IDBObjectStore.prototype.count;
  t.mock.method(IDBObjectStore.prototype, "count", function(this: InstanceType<typeof IDBObjectStore>, ...args: Parameters<typeof original>) {
    const request = original.apply(this, args);
    this.transaction.abort();
    return request;
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

test("clearing while a page is loading cannot resurrect deleted history", async () => {
  await seed(95);
  await useStore.getState().loadGallery();
  await Promise.all([useStore.getState().loadMoreGallery(), useStore.getState().clearGallery()]);
  assert.equal(useStore.getState().images.length, 0);
  assert.equal(useStore.getState().galleryNext, null);
  assert.equal(useStore.getState().galleryLoadingMore, false);
});

test("generation before history initialization still exposes older pages without pruning", async () => {
  await seed(198);
  await useStore.getState().appendGalleryImages([picture(199)]);
  assert.notEqual(useStore.getState().galleryNext, null);
  await useStore.getState().loadMoreGallery();
  assert.equal(useStore.getState().images.length, 41);
  await useStore.getState().appendGalleryImages([picture(200)]);
  assert.equal(useStore.getState().galleryCount, 200);
  assert.equal((await loadImages(2)).images[0].id, 1);
});
