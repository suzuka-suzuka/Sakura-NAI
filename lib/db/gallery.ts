import type { GenerationSettings } from "@/lib/nai/types";

// IndexedDB-backed local gallery. Each record keeps a full settings snapshot + the
// resolved seed so any image can restore the whole form or be exported with its recipe.

export type GalleryImage = {
  id?: number;
  dataUrl: string;
  timestamp: string;
  filename: string;
  seed: number;
  settings: GenerationSettings;
  batchId: number;
  batchIndex: number;
  batchSize: number;
  /** Set when the image is the output of a director tool rather than a fresh generation. */
  processedWith?: string;
};

// Preserve existing history while adding a small metadata store for retention checks.
const DB_NAME = "nyanovel-images";
const STORE = "images", INFO = "image-info", STATE = "gallery-state";
export const GALLERY_LIMIT = { count: 200, bytes: 500 * 1024 * 1024 };
export const GALLERY_PAGE_SIZE = 40;
type ImageInfo = { id: number; bytes: number; batchId: number };
export type GalleryReport = { count: number; bytes: number; ids: number[]; deleted: number; warn: boolean };

// Serialized payload estimate, including settings/references; excludes browser-specific overhead.
export function imageBytes(image: GalleryImage): number {
  const { dataUrl, ...metadata } = image;
  return new Blob([dataUrl]).size + new Blob([JSON.stringify(metadata)]).size;
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available in this environment"));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(INFO)) {
        const info = db.createObjectStore(INFO, { keyPath: "id" });
        const cursor = req.transaction!.objectStore(STORE).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const image = row.value as GalleryImage;
          info.put({ id: image.id, bytes: imageBytes(image), batchId: image.batchId });
          row.continue();
        };
      }
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
    };
    let blocked = false;
    req.onblocked = () => { blocked = true; reject(new Error("Close other tabs of this site, then retry loading history.")); };
    req.onsuccess = () => { if (blocked) { req.result.close(); return; } req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([STORE, INFO, STATE], mode);
    let value: T;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Gallery transaction aborted")); };
    try { run(tx, result => { value = result; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
export function retentionPlan(rows: ImageInfo[], limits = GALLERY_LIMIT) {
  let bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const kept = [...rows], removed: number[] = [];
  // Delete oldest complete batches, so the remaining batch controls stay consistent.
  while (kept.length && (kept.length >= limits.count || bytes >= limits.bytes)) {
    const batchId = kept[0].batchId;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].batchId !== batchId) continue;
      bytes -= kept[i].bytes;
      removed.push(kept[i].id);
      kept.splice(i, 1);
    }
  }
  return { kept, removed, bytes };
}
function maintain(tx: IDBTransaction, done: (report: GalleryReport) => void) {
  const info = tx.objectStore(INFO), request = info.getAll(); // Metadata only.
  request.onsuccess = () => {
    const rows = request.result as ImageInfo[];
    const beforeBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    const high = rows.length >= GALLERY_LIMIT.count * .8 || beforeBytes >= GALLERY_LIMIT.bytes * .8;
    const plan = retentionPlan(rows);
    for (const id of plan.removed) { info.delete(id); tx.objectStore(STORE).delete(id); }
    const state = tx.objectStore(STATE), warning = state.get("warned");
    warning.onsuccess = () => {
      const stillHigh = plan.kept.length >= GALLERY_LIMIT.count * .8 || plan.bytes >= GALLERY_LIMIT.bytes * .8;
      state.put(stillHigh, "warned");
      done({ count: plan.kept.length, bytes: plan.bytes, ids: plan.kept.map(row => row.id), deleted: plan.removed.length, warn: high && !warning.result });
    };
  };
}
export function maintainGallery(): Promise<GalleryReport> {
  return transaction("readwrite", (tx, done) => maintain(tx, done));
}
export function saveImages(images: GalleryImage[]): Promise<{ images: GalleryImage[]; report: GalleryReport }> {
  const clean = images.map(({ id: _id, ...image }) => ({ ...image, settings: structuredClone(image.settings) } as GalleryImage));
  if (clean.length >= GALLERY_LIMIT.count || clean.reduce((sum, image) => sum + imageBytes(image), 0) >= GALLERY_LIMIT.bytes) {
    return Promise.reject(new Error("This batch exceeds the local history limit"));
  }
  return transaction("readwrite", (tx, done) => {
    let remaining = clean.length;
    if (!remaining) return maintain(tx, report => done({ images: [], report }));
    for (const image of clean) {
      const bytes = imageBytes(image), req = tx.objectStore(STORE).add(image);
      req.onsuccess = () => {
        image.id = req.result as number;
        tx.objectStore(INFO).put({ id: image.id, bytes, batchId: image.batchId });
        if (!--remaining) maintain(tx, report => done({ images: clean, report }));
      };
    }
  });
}
/** Keyset pages stay stable across inserts. Include the whole boundary batch. */
export function loadImages(before?: number, limit = GALLERY_PAGE_SIZE): Promise<{ images: GalleryImage[]; next: number | null }> {
  return transaction("readonly", (tx, done) => {
    const images: GalleryImage[] = [];
    const req = tx.objectStore(STORE).openCursor(before === undefined ? undefined : IDBKeyRange.upperBound(before, true), "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done({ images, next: null });
      const image = cursor.value as GalleryImage;
      if (images.length >= limit && image.batchId !== images[images.length - 1].batchId) return done({ images, next: images[images.length - 1].id! });
      images.push(image);
      cursor.continue();
    };
  });
}
export function deleteImage(id: number): Promise<GalleryReport> {
  return transaction("readwrite", (tx, done) => {
    tx.objectStore(STORE).delete(id); tx.objectStore(INFO).delete(id); maintain(tx, done);
  });
}
export function clearImages(): Promise<void> {
  return transaction("readwrite", (tx, done) => {
    for (const name of [STORE, INFO, STATE]) tx.objectStore(name).clear();
    done(undefined);
  });
}
