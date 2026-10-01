import type { GenerationSettings } from "./types";
import { focusedCrop } from "../editor-geometry";

/** Prepare a detail crop and an exact-mask compositor; none of this work calls the API. */
export async function prepareFocusedInpainting(s: GenerationSettings, signal?: AbortSignal) {
  const source = s.imageSource;
  if (source?.mode !== "infill" || !source.focused) return null;
  signal?.throwIfAborted();
  if (!source.mask) throw new Error("Draw an inpainting mask first");
  const decode = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); signal?.throwIfAborted(); return image; };
  const [original, maskImage] = await Promise.all([decode(source.dataUrl), decode(source.mask)]);
  const canvas = (width: number, height: number) => {
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    const ctx = c.getContext("2d"); if (!ctx) throw new Error("Unable to prepare inpainting image");
    return { c, ctx };
  };
  const mask = canvas(source.width, source.height);
  mask.ctx.imageSmoothingEnabled = false; mask.ctx.drawImage(maskImage, 0, 0, source.width, source.height);
  const maskPixels = mask.ctx.getImageData(0, 0, source.width, source.height);
  const crop = focusedCrop(maskPixels.data, source.width, source.height, s.width / s.height);
  if (!crop) throw new Error("Draw an inpainting mask first");
  const input = canvas(s.width, s.height), inputMask = canvas(s.width, s.height);
  input.ctx.drawImage(original, crop.x, crop.y, crop.width, crop.height, 0, 0, s.width, s.height);
  inputMask.ctx.imageSmoothingEnabled = false;
  inputMask.ctx.drawImage(mask.c, crop.x, crop.y, crop.width, crop.height, 0, 0, s.width, s.height);
  const pixels = inputMask.ctx.getImageData(0, 0, s.width, s.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i] > 127 ? 255 : 0;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
  }
  inputMask.ctx.putImageData(pixels, 0, 0);
  const prepared: GenerationSettings = { ...s, imageSource: { ...source, focused: false, dataUrl: input.c.toDataURL("image/png"), mask: inputMask.c.toDataURL("image/png"), width: s.width, height: s.height } };
  const compose = async (generatedUrl: string) => {
    const generated = await decode(generatedUrl);
    const patch = canvas(crop.width, crop.height);
    patch.ctx.drawImage(generated, 0, 0, crop.width, crop.height);
    const replacement = patch.ctx.getImageData(0, 0, crop.width, crop.height);
    const result = canvas(source.width, source.height);
    result.ctx.drawImage(original, 0, 0, source.width, source.height);
    const base = result.ctx.getImageData(0, 0, source.width, source.height);
    for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
      const i = ((crop.y + y) * source.width + crop.x + x) * 4;
      if (maskPixels.data[i] > 127) base.data.set(replacement.data.subarray((y * crop.width + x) * 4, (y * crop.width + x) * 4 + 4), i);
    }
    result.ctx.putImageData(base, 0, 0);
    return result.c.toDataURL("image/png");
  };
  signal?.throwIfAborted();
  return { settings: prepared, compose };
}
