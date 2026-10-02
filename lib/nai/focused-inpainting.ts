import type { GenerationSettings } from "./types";
import { focusedCrop } from "../editor-geometry";
import { prepareInpainting } from "./image-input";
import { compositeInpainting } from "./inpainting-composite";

/** Prepare a detail crop with the same soft composite mask as ordinary inpainting. */
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
  mask.ctx.drawImage(maskImage, 0, 0, source.width, source.height);
  const maskPixels = mask.ctx.getImageData(0, 0, source.width, source.height);
  const crop = focusedCrop(maskPixels.data, source.width, source.height, s.width / s.height);
  if (!crop) throw new Error("Draw an inpainting mask first");
  const input = canvas(s.width, s.height), inputMask = canvas(s.width, s.height);
  input.ctx.drawImage(original, crop.x, crop.y, crop.width, crop.height, 0, 0, s.width, s.height);
  inputMask.ctx.drawImage(mask.c, crop.x, crop.y, crop.width, crop.height, 0, 0, s.width, s.height);
  const prepared: GenerationSettings = { ...s, imageSource: { ...source, focused: false, dataUrl: input.c.toDataURL("image/png"), mask: inputMask.c.toDataURL("image/png"), width: s.width, height: s.height } };
  const inpainting = await prepareInpainting(prepared, signal);
  if (!inpainting.compositeMask) throw new Error("Unable to prepare inpainting mask");
  const blend = canvas(crop.width, crop.height);
  blend.ctx.drawImage(inpainting.compositeMask, 0, 0, crop.width, crop.height);
  const blendPixels = blend.ctx.getImageData(0, 0, crop.width, crop.height);
  const sourceCanvas = canvas(source.width, source.height);
  sourceCanvas.ctx.drawImage(original, 0, 0, source.width, source.height);
  const cropBase = sourceCanvas.ctx.getImageData(crop.x, crop.y, crop.width, crop.height);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const full = ((crop.y + y) * source.width + crop.x + x) * 4, local = (y * crop.width + x) * 4;
    if (cropBase.data[local + 3] === 0 && maskPixels.data[full] * maskPixels.data[full + 3] / 255 > 155)
      blendPixels.data[local + 3] = 255;
  }
  const compose = async (generatedUrl: string) => {
    const generated = await decode(generatedUrl);
    const patch = canvas(crop.width, crop.height);
    patch.ctx.drawImage(generated, 0, 0, crop.width, crop.height);
    const replacement = patch.ctx.getImageData(0, 0, crop.width, crop.height);
    const result = canvas(source.width, source.height);
    result.ctx.drawImage(sourceCanvas.c, 0, 0);
    replacement.data.set(compositeInpainting(cropBase.data, replacement.data, blendPixels.data));
    result.ctx.putImageData(replacement, crop.x, crop.y);
    return result.c.toDataURL("image/png");
  };
  signal?.throwIfAborted();
  return { settings: inpainting.settings, compose };
}
