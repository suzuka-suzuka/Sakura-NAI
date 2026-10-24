type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

/** Some iOS webviews can display a file even when ImageBitmap cannot decode it. */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0)
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      bitmap.close();
    } catch { /* Try the browser's ordinary image decoder before rejecting the file. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The image could not be read."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("The image could not be read.");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function readImageDimensions(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  if (bytes.length === 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    new TextDecoder().decode(bytes.subarray(12, 16)) === "IHDR") {
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width && height) return { width, height };
  }
  const image = await decodeImage(blob);
  try { return { width: image.width, height: image.height }; }
  finally { image.close(); }
}
