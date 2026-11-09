import { throwIfAborted } from "./nai/abort";
import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { getExportImage, loadExportImage, type GalleryImage } from "./db/gallery";

export const EXPORT_PART_BYTES = 512 * 1024 * 1024;
const MIN_PART_BYTES = 64 * 1024 * 1024;
type ExportOptions = { signal: AbortSignal; onProgress: (count: number) => void };

export async function* exportImages(temporary: GalleryImage[]): AsyncGenerator<GalleryImage> {
  yield* temporary;
  let before: number | undefined;
  while (true) {
    const image = await loadExportImage(before);
    if (!image) return;
    before = image.id;
    yield image;
  }
}

function imageBase64(image: GalleryImage) {
  const comma = image.dataUrl.indexOf(",");
  if (comma < 0 || !image.dataUrl.slice(0, comma).endsWith(";base64")) throw new Error("Invalid image data");
  return image.dataUrl.slice(comma + 1);
}

function imageContent(image: GalleryImage) {
  const base64 = imageBase64(image);
  const size = base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  let offset = 0;
  return { size, stream: new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= base64.length) { controller.close(); return; }
      // Aligned base64 chunks avoid a second full-size decoded image in memory.
      const text = atob(base64.slice(offset, offset + 65536));
      offset += 65536;
      controller.enqueue(Uint8Array.from(text, char => char.charCodeAt(0)));
    },
  }) };
}

function uniqueName(filename: string, names: Set<string>) {
  const base = filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "_") || "image.png";
  const safe = base === "." || base === ".." ? "image.png" : base;
  let name = safe, suffix = 2;
  const dot = safe.lastIndexOf(".");
  while (names.has(name.toLowerCase())) {
    name = dot > 0 ? `${safe.slice(0, dot)} (${suffix++})${safe.slice(dot)}` : `${safe} (${suffix++})`;
  }
  names.add(name.toLowerCase());
  return name;
}

const zipOptions = { level: 0, bufferedWrite: false, useWebWorkers: false } as const;

/** Sequential add() awaits the sink, so disk backpressure also stops database reads. */
export async function writeGalleryZip(source: AsyncIterable<GalleryImage>, sink: WritableStream<Uint8Array>, options: ExportOptions) {
  const zip = new ZipWriter(sink, { ...zipOptions, zip64: true, preventClose: true });
  const names = new Set<string>();
  let count = 0;
  try {
    for await (const image of source) {
      throwIfAborted(options.signal);
      await zip.add(uniqueName(image.filename, names), imageContent(image).stream, { signal: options.signal });
      options.onProgress(++count);
    }
    throwIfAborted(options.signal);
    await zip.close();
    throwIfAborted(options.signal);
    await sink.close();
  } catch (error) {
    await sink.abort(error).catch(() => {});
    throw error;
  }
}

function isAllocationFailure(error: unknown) {
  return error instanceof Error && /out of memory|not enough memory|insufficient memory|allocation failed|invalid (?:array(?:buffer)?|typed array) length|(?:cannot|can't|failed to) (?:construct|create).*blob/i.test(error.message);
}

type PendingImage = { name: string; bytes: number } & ({ id: number } | { image: GalleryImage });

async function createPart(entries: PendingImage[], options: ExportOptions, completed: number) {
  const zip = new ZipWriter(new BlobWriter("application/zip"), zipOptions);
  for (let index = 0; index < entries.length; index++) {
    throwIfAborted(options.signal);
    const entry = entries[index];
    const image = "id" in entry ? await getExportImage(entry.id) : entry.image;
    if (!image) throw new Error("A history image was removed during export. Please retry.");
    await zip.add(entry.name, imageContent(image).stream, { signal: options.signal });
    options.onProgress(completed + index + 1);
  }
  throwIfAborted(options.signal);
  return zip.close();
}

/** Retry only unsaved entries; persisted images are reloaded by ID, not retained in RAM. */
export async function writeGalleryParts(source: AsyncIterable<GalleryImage>, options: ExportOptions & {
  onPart: (blob: Blob, filename: string) => Promise<void>;
  partBytes?: number;
  minPartBytes?: number;
}) {
  let limit = options.partBytes ?? EXPORT_PART_BYTES;
  const minimum = Math.min(limit, options.minPartBytes ?? MIN_PART_BYTES);
  const pending: PendingImage[] = [];
  let size = 0, count = 0, part = 0;
  const names = new Set<string>();
  const oversized = () => new Error("An image is too large for split download. Use desktop Chrome or Edge to export directly to a file.");
  const flush = async () => {
    while (pending.length) {
      throwIfAborted(options.signal);
      let length = 0, bytes = 0;
      if (pending[0].bytes > limit) throw oversized();
      while (length < pending.length && bytes + pending[length].bytes <= limit) bytes += pending[length++].bytes;
      let blob: Blob;
      try {
        blob = await createPart(pending.slice(0, length), options, count);
      } catch (error) {
        throwIfAborted(options.signal);
        // Data, database, permission and download errors must not trigger memory retries.
        if (!isAllocationFailure(error) || limit <= minimum) throw error;
        limit = Math.max(minimum, Math.floor(limit / 2));
        options.onProgress(count);
        // Failed writer/buffers are out of scope; allow the browser to reclaim them.
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }
      throwIfAborted(options.signal);
      await options.onPart(blob, `sakura-history-${String(part + 1).padStart(3, "0")}.zip`);
      throwIfAborted(options.signal);
      part++;
      count += length;
      pending.splice(0, length);
    }
    size = 0;
  };
  for await (const image of source) {
    throwIfAborted(options.signal);
    const base64 = imageBase64(image);
    const bytes = base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    // Reserve space for both headers, UTF-8 filenames, descriptors and ZIP64 fields.
    const entrySize = bytes + new TextEncoder().encode(image.filename).length * 2 + 1024;
    if (entrySize > limit) throw oversized();
    if (pending.length && (size + entrySize > limit || pending.length >= 1000)) await flush();
    if (entrySize > limit) throw oversized();
    pending.push({ name: uniqueName(image.filename, names), bytes: entrySize, ...(image.id && image.id > 0 ? { id: image.id } : { image }) });
    size += entrySize;
  }
  await flush();
}
