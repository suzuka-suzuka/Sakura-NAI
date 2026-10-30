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

// Keep the original image store; v3 removes only obsolete retention metadata.
const DB_NAME = "nyanovel-images";
const STORE = "images";
export const GALLERY_PAGE_SIZE = 40;
export type GalleryReport = { count: number };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available in this environment"));
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      for (const name of ["image-info", "gallery-state"]) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
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
    const tx = db.transaction([STORE], mode);
    let value: T;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Gallery transaction aborted")); };
    try { run(tx, result => { value = result; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
function readReport(tx: IDBTransaction, done: (report: GalleryReport) => void) {
  const request = tx.objectStore(STORE).count();
  request.onsuccess = () => done({ count: request.result });
}
export function getGalleryReport(): Promise<GalleryReport> {
  return transaction("readonly", (tx, done) => readReport(tx, done));
}
export function saveImages(images: GalleryImage[]): Promise<{ images: GalleryImage[]; report: GalleryReport }> {
  const clean = images.map(({ id: _id, ...image }) => ({ ...image, settings: structuredClone(image.settings) } as GalleryImage));
  return transaction("readwrite", (tx, done) => {
    let remaining = clean.length;
    if (!remaining) return readReport(tx, report => done({ images: [], report }));
    for (const image of clean) {
      const req = tx.objectStore(STORE).add(image);
      req.onsuccess = () => {
        image.id = req.result as number;
        if (!--remaining) readReport(tx, report => done({ images: clean, report }));
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
    tx.objectStore(STORE).delete(id); readReport(tx, done);
  });
}
export function clearImages(): Promise<void> {
  return transaction("readwrite", (tx, done) => {
    tx.objectStore(STORE).clear();
    done(undefined);
  });
}
