import type { ReferenceImage } from "../nai/types";
import { validateStoredPresets, validateStoredReferences, type StylePreset } from "../style-presets";

type ReferenceSession = { vibe: ReferenceImage[]; directorReference: ReferenceImage[] };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sakura-style-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function access<T>(key: string, value?: T): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", value === undefined ? "readonly" : "readwrite");
    const store = tx.objectStore("data");
    const request = value === undefined ? store.get(key) : store.put(structuredClone(value), key);
    tx.oncomplete = () => { db.close(); resolve(value === undefined ? request.result as T | undefined : value); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error); };
  });
}
export async function loadStyleLibrary(): Promise<StylePreset[]> {
  const value = await access<StylePreset[]>("presets");
  return value ? validateStoredPresets(value) : [];
}
export async function saveStyleLibrary(presets: StylePreset[]): Promise<void> {
  await access("presets", validateStoredPresets(presets));
}
export async function loadReferenceSession(): Promise<ReferenceSession | null> {
  const value = await access<ReferenceSession>("references");
  return value ? { vibe: validateStoredReferences(value.vibe), directorReference: validateStoredReferences(value.directorReference) } : null;
}
export async function saveReferenceSession(value: ReferenceSession): Promise<void> { await access("references", value); }
