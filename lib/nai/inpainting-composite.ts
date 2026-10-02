/** Mix replacement pixels in premultiplied RGBA; zero coverage retains every source byte. */
export function compositeInpainting(base: Uint8ClampedArray, generated: Uint8ClampedArray, mask: Uint8ClampedArray) {
  if (base.length !== generated.length || base.length !== mask.length || base.length % 4)
    throw new Error("Inpainting image and mask dimensions must match");
  const result = base.slice();
  for (let i = 0; i < result.length; i += 4) {
    const weight = mask[i] * mask[i + 3] / 65025;
    if (weight === 0) continue;
    if (weight === 1) { result.set(generated.subarray(i, i + 4), i); continue; }
    const sourceWeight = (1 - weight) * base[i + 3] / 255;
    const generatedWeight = weight * generated[i + 3] / 255;
    const alpha = sourceWeight + generatedWeight;
    for (let c = 0; c < 3; c++)
      result[i + c] = alpha ? Math.round((base[i + c] * sourceWeight + generated[i + c] * generatedWeight) / alpha) : 0;
    result[i + 3] = Math.round(alpha * 255);
  }
  return result;
}

/** The public API uses a full-size opaque mask sampled from the 8px latent grid. */
export function requestInpaintingMask(mask: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    mask.length !== width * height * 4 || width % 8 || height % 8)
    throw new Error("Invalid inpainting mask dimensions");
  const result = new Uint8ClampedArray(mask.length);
  let selected = false;
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const sample = ((y + 4) * width + x + 4) * 4;
    const value = mask[sample] * mask[sample + 3] / 255 > 155 ? 255 : 0;
    selected ||= value === 255;
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
      const i = ((y + dy) * width + x + dx) * 4;
      result[i] = result[i + 1] = result[i + 2] = value; result[i + 3] = 255;
    }
  }
  if (!selected) throw new Error("The inpainting mask is too small. Draw a larger mask first.");
  return result;
}

/** Edge-clamped box blur with the official worker's radius, iterations and integer normalization. */
function blurCoverage(coverage: Uint8Array, width: number, height: number) {
  const radius = 20;
  const horizontal = new Int32Array(coverage.length);
  const output = new Uint8Array(coverage.length);
  for (let iteration = 0; iteration < 2; iteration++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx++) sum += coverage[row + Math.max(0, Math.min(width - 1, dx))];
      for (let x = 0; x < width; x++) {
        horizontal[row + x] = sum;
        sum += coverage[row + Math.min(width - 1, x + radius + 1)] - coverage[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) sum += horizontal[Math.max(0, Math.min(height - 1, dy)) * width + x];
      for (let y = 0; y < height; y++) {
        output[y * width + x] = Math.min(255, (sum * 39) >>> 16);
        sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x] - horizontal[Math.max(0, y - radius) * width + x];
      }
    }
    coverage.set(output);
  }
  return coverage;
}

/** Derive the binary request and soft replacement mask from one latent selection. */
export function prepareInpaintingMasks(mask: Uint8ClampedArray, width: number, height: number, base?: Uint8ClampedArray) {
  const requestMask = requestInpaintingMask(mask, width, height);
  if (base && base.length !== mask.length) throw new Error("Inpainting image and mask dimensions must match");
  const latentWidth = width / 8, latentHeight = height / 8;
  let latent = new Uint8Array(latentWidth * latentHeight);
  for (let y = 0; y < latentHeight; y++) for (let x = 0; x < latentWidth; x++)
    latent[y * latentWidth + x] = requestMask[(y * 8 * width + x * 8) * 4];
  // Four latent pixels give the generated patch room to blend into its context.
  for (let iteration = 0; iteration < 4; iteration++) {
    const expanded = new Uint8Array(latent.length);
    for (let y = 0; y < latentHeight; y++) for (let x = 0; x < latentWidth; x++) {
      let selected = false;
      for (let dy = -1; dy <= 1 && !selected; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < latentWidth && ny >= 0 && ny < latentHeight && latent[ny * latentWidth + nx]) { selected = true; break; }
      }
      expanded[y * latentWidth + x] = selected ? 255 : 0;
    }
    latent = expanded;
  }
  const coverage = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    coverage[y * width + x] = latent[Math.floor(y / 8) * latentWidth + Math.floor(x / 8)];
  blurCoverage(coverage, width, height);
  const compositeMask = new Uint8ClampedArray(mask.length);
  for (let i = 0, p = 0; i < mask.length; i += 4, p++) {
    compositeMask[i] = compositeMask[i + 1] = compositeMask[i + 2] = 255;
    // Fully replace selected empty pixels, so outpainting never leaves a translucent gap.
    compositeMask[i + 3] = base?.[i + 3] === 0 && requestMask[i] === 255 ? 255 : coverage[p];
  }
  return { requestMask, compositeMask };
}
