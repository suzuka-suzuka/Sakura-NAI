import type { GenerationPayload } from "./protocol";
import type { GenerationSettings } from "./types";
import { isV5Model } from "./models";
import { compositeInpainting, requestInpaintingMask } from "./inpainting-composite";

const imageBytes = (url: string) => url.replace(/^data:image\/[^;]+;base64,/, "");

/** Image and mask data are submitted explicitly; website-only cache keys are never needed. */
export function applyImageInput(payload: GenerationPayload, s: GenerationSettings, seed: number): GenerationPayload {
  const image = s.imageSource;
  if (!image) return payload;
  if (!image.dataUrl || !Number.isFinite(image.strength) || image.strength < 0 || image.strength > 1 ||
    !Number.isFinite(image.noise) || image.noise < 0 || image.noise > 1)
    throw new Error("Invalid image strength or noise");
  const p = payload.parameters;
  if (image.upscaledEnhance) {
    if (image.mode !== "img2img" || !isV5Model(s.model)) throw new Error("Max enhancement requires V5 Image2Image");
    p.upscaled_enhance = true;
  }
  payload.action = image.mode;
  Object.assign(p, { image: imageBytes(image.dataUrl), strength: image.strength, noise: image.noise,
    extra_noise_seed: (seed - 1) >>> 0, add_original_image: image.mode !== "infill", color_correct: false });
  if (image.mode === "infill") {
    if (!image.mask) throw new Error("Draw an inpainting mask first");
    if (![image.width, image.height].every(n => Number.isInteger(n) && n > 0)) throw new Error("Invalid source image dimensions");
    if (!Number.isFinite(image.inpaintStrength) || image.inpaintStrength < 0 || image.inpaintStrength > 1)
      throw new Error("Invalid inpainting strength");
    payload.model = `${s.model}-inpainting`;
    p.mask = imageBytes(image.mask);
    p.inpaintImg2ImgStrength = image.inpaintStrength;
    if (image.inpaintStrength !== 1 && (isV5Model(s.model) || s.model.includes("diffusion-4")))
      p.img2img = { strength: image.inpaintStrength, color_correct: true };
  }
  return payload;
}

/** Resize the image and binary mask together to the chosen generation canvas. */
export async function prepareImageInput(s: GenerationSettings, signal?: AbortSignal): Promise<GenerationSettings> {
  signal?.throwIfAborted();
  const source = s.imageSource;
  if (source?.mode !== "infill" || (source.width === s.width && source.height === s.height)) return s;
  const resize = async (url: string, mask: boolean) => {
    const image = new Image(); image.src = url; await image.decode();
    signal?.throwIfAborted();
    const canvas = document.createElement("canvas"); canvas.width = s.width; canvas.height = s.height;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Unable to prepare inpainting image");
    ctx.imageSmoothingEnabled = !mask;
    ctx.drawImage(image, 0, 0, s.width, s.height);
    if (mask) {
      const pixels = ctx.getImageData(0, 0, s.width, s.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = pixels.data[i] > 127 ? 255 : 0;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    return canvas.toDataURL("image/png");
  };
  if (!source.mask) throw new Error("Draw an inpainting mask first");
  const [dataUrl, mask] = await Promise.all([resize(source.dataUrl, false), resize(source.mask, true)]);
  signal?.throwIfAborted();
  return { ...s, imageSource: { ...source, dataUrl, mask, width: s.width, height: s.height } };
}

/** Infill returns a generated canvas; restore the untouched source before displaying or saving it. */
export async function prepareInpainting(s: GenerationSettings, signal?: AbortSignal) {
  const settings = await prepareImageInput(s, signal), source = settings.imageSource;
  if (source?.mode !== "infill") return { settings };
  if (!source.mask) throw new Error("Draw an inpainting mask first");
  const decode = async (url: string) => {
    const image = new Image(); image.src = url; await image.decode(); signal?.throwIfAborted(); return image;
  };
  const canvas = () => {
    const c = document.createElement("canvas"); c.width = settings.width; c.height = settings.height;
    const ctx = c.getContext("2d"); if (!ctx) throw new Error("Unable to prepare inpainting image");
    return { c, ctx };
  };
  const [original, maskImage] = await Promise.all([decode(source.dataUrl), decode(source.mask)]);
  if (original.naturalWidth !== settings.width || original.naturalHeight !== settings.height ||
    maskImage.naturalWidth !== settings.width || maskImage.naturalHeight !== settings.height)
    throw new Error("Inpainting image and mask dimensions must match the generation canvas");
  const mask = canvas(); mask.ctx.drawImage(maskImage, 0, 0);
  const maskPixels = mask.ctx.getImageData(0, 0, settings.width, settings.height);
  const requestPixels = mask.ctx.createImageData(settings.width, settings.height);
  requestPixels.data.set(requestInpaintingMask(maskPixels.data, settings.width, settings.height));
  mask.ctx.putImageData(requestPixels, 0, 0);
  const result = canvas(); result.ctx.drawImage(original, 0, 0);
  const base = result.ctx.getImageData(0, 0, settings.width, settings.height);
  const compose = async (url: string) => {
    const image = await decode(url);
    const patch = canvas(); patch.ctx.drawImage(image, 0, 0, settings.width, settings.height);
    const pixels = patch.ctx.getImageData(0, 0, settings.width, settings.height);
    pixels.data.set(compositeInpainting(base.data, pixels.data, requestPixels.data));
    patch.ctx.putImageData(pixels, 0, 0);
    return patch.c.toDataURL("image/png");
  };
  return { settings: { ...settings, imageSource: { ...source, mask: mask.c.toDataURL("image/png") } }, compose };
}
