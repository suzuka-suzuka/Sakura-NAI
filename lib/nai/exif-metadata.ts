export type MetadataEntry = { keyword: string; text: string };
const utf8 = new TextDecoder();

/** Read only recipe-related TIFF tags; never copy camera/GPS data into a recipe. */
export function readExifMetadata(input: Uint8Array): MetadataEntry[] {
  // JPEG APP1 includes this prefix; WebP EXIF and PNG eXIf may start at the TIFF header.
  const bytes = utf8.decode(input.subarray(0, 6)) === "Exif\0\0" ? input.subarray(6) : input;
  if (bytes.length < 8) throw new Error("Truncated EXIF header");
  const order = utf8.decode(bytes.subarray(0, 2));
  if (order !== "II" && order !== "MM") throw new Error("Invalid EXIF byte order");
  const little = order === "II", view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, little) !== 42) throw new Error("Invalid EXIF header");
  const entries: MetadataEntry[] = [], visited = new Set<number>();
  const names: Record<number, string> = { 0x10e: "Description", 0x131: "Source", 0x9286: "Comment" };
  const visit = (offset: number) => {
    if (!offset || visited.has(offset)) return;
    if (visited.size >= 8 || offset < 8 || offset + 2 > bytes.length) throw new Error("Invalid EXIF directory");
    visited.add(offset);
    const count = view.getUint16(offset, little);
    if (offset + 2 + count * 12 + 4 > bytes.length) throw new Error("Truncated EXIF directory");
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = view.getUint16(at, little);
      const type = view.getUint16(at + 2, little), size = view.getUint32(at + 4, little);
      if (tag === 0x8769 && type === 4 && size === 1) { visit(view.getUint32(at + 8, little)); continue; }
      const keyword = names[tag];
      if (!keyword || ![1, 2, 7].includes(type) || !size) continue;
      const start = size <= 4 ? at + 8 : view.getUint32(at + 8, little);
      if (start + size > bytes.length) throw new Error("Truncated EXIF value");
      let data = bytes.subarray(start, start + size);
      let decoder = utf8;
      if (tag === 0x9286 && data.length >= 8) {
        const encoding = utf8.decode(data.subarray(0, 8));
        if (encoding === "UNICODE\0") {
          data = data.subarray(8);
          const bigEndian = data[0] === 0xfe && data[1] === 0xff;
          const littleEndian = data[0] === 0xff && data[1] === 0xfe;
          decoder = new TextDecoder(bigEndian ? "utf-16be" : littleEndian || little ? "utf-16le" : "utf-16be");
        } else if (encoding === "ASCII\0\0\0" || data.subarray(0, 8).every(v => v === 0)) data = data.subarray(8);
        else if (encoding === "JIS\0\0\0\0\0") continue;
      }
      const text = decoder.decode(data).replace(/\0+$/, "");
      if (text) entries.push({ keyword, text });
    }
    // IFD1 describes a thumbnail; its fields must not overwrite the full image's recipe.
  };
  visit(view.getUint32(4, little));
  return entries;
}

/** Extract original EXIF bytes before any canvas conversion can discard them. */
export function readContainerExif(bytes: Uint8Array): MetadataEntry[] {
  const entries: MetadataEntry[] = [];
  let error: unknown;
  const read = (data: Uint8Array) => {
    try { entries.push(...readExifMetadata(data)); }
    catch (e) { error = e; }
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (utf8.decode(bytes.subarray(0, 4)) === "RIFF" && utf8.decode(bytes.subarray(8, 12)) === "WEBP") {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length) throw new Error("Truncated WebP container");
    for (let offset = 12; offset + 8 <= end;) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > end) throw new Error("Truncated WebP chunk");
      if (utf8.decode(bytes.subarray(offset, offset + 4)) === "EXIF") read(bytes.subarray(offset + 8, offset + 8 + size));
      offset += 8 + size + (size % 2);
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break; // Scan data and EOI are not metadata.
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) throw new Error("Truncated JPEG segment");
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw new Error("Truncated JPEG segment");
      const data = bytes.subarray(offset + 2, offset + size);
      if (marker === 0xe1 && utf8.decode(data.subarray(0, 6)) === "Exif\0\0") read(data);
      offset += size;
    }
  }
  if (!entries.length && error) throw error;
  return entries;
}
