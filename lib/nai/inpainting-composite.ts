/** Replace only white mask pixels. Black mask pixels retain every source RGBA byte. */
export function compositeInpainting(base: Uint8ClampedArray, generated: Uint8ClampedArray, mask: Uint8ClampedArray) {
  if (base.length !== generated.length || base.length !== mask.length || base.length % 4)
    throw new Error("Inpainting image and mask dimensions must match");
  const result = base.slice();
  for (let i = 0; i < result.length; i += 4)
    if (mask[i] > 127 && mask[i + 3] > 0) result.set(generated.subarray(i, i + 4), i);
  return result;
}

/** The public API uses a full-size opaque mask sampled from the 8px latent grid. */
export function requestInpaintingMask(mask: Uint8ClampedArray, width: number, height: number) {
  if (mask.length !== width * height * 4 || width % 8 || height % 8)
    throw new Error("Invalid inpainting mask dimensions");
  const result = new Uint8ClampedArray(mask.length);
  let selected = false;
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const sample = ((y + 4) * width + x + 4) * 4;
    const value = mask[sample] > 127 && mask[sample + 3] > 0 ? 255 : 0;
    selected ||= value === 255;
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
      const i = ((y + dy) * width + x + dx) * 4;
      result[i] = result[i + 1] = result[i + 2] = value; result[i + 3] = 255;
    }
  }
  if (!selected) throw new Error("The inpainting mask is too small. Draw a larger mask first.");
  return result;
}
