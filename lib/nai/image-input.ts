import type { GenerationPayload } from "./protocol";
import type { GenerationSettings } from "./types";

const imageBytes = (url: string) => url.replace(/^data:image\/[^;]+;base64,/, "");

/** Image and mask data are submitted explicitly; website-only cache keys are never needed. */
export function applyImageInput(payload: GenerationPayload, s: GenerationSettings, seed: number): GenerationPayload {
  const image = s.imageSource;
  if (!image) return payload;
  if (!image.dataUrl || !Number.isFinite(image.strength) || image.strength < 0 || image.strength > 1 ||
    !Number.isFinite(image.noise) || image.noise < 0 || image.noise > 1)
    throw new Error("Invalid image strength or noise");
  const p = payload.parameters;
  payload.action = image.mode;
  Object.assign(p, { image: imageBytes(image.dataUrl), strength: image.strength, noise: image.noise,
    extra_noise_seed: (seed - 1) >>> 0, add_original_image: image.mode !== "infill", color_correct: false });
  if (image.mode === "infill") {
    if (!image.mask) throw new Error("Draw an inpainting mask first");
    if (image.width !== s.width || image.height !== s.height) throw new Error("Inpainting dimensions must match the source image");
    if (!Number.isFinite(image.inpaintStrength) || image.inpaintStrength < 0 || image.inpaintStrength > 1)
      throw new Error("Invalid inpainting strength");
    payload.model = `${s.model}-inpainting`;
    p.mask = imageBytes(image.mask);
    p.inpaintImg2ImgStrength = image.inpaintStrength;
  }
  return payload;
}
