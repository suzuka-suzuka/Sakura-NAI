// NovelAI wire values, owned by this application. No SDK metadata transformation.
export enum Model {
  V3 = "nai-diffusion-3", FURRY = "nai-diffusion-furry-3",
  V4 = "nai-diffusion-4-full", V4_CUR = "nai-diffusion-4-curated-preview",
  V4_5 = "nai-diffusion-4-5-full", V4_5_CUR = "nai-diffusion-4-5-curated",
}
export enum Sampler {
  EULER = "k_euler", EULER_ANC = "k_euler_ancestral", DPM2S_ANC = "k_dpmpp_2s_ancestral",
  DPM2M = "k_dpmpp_2m", DPMSDE = "k_dpmpp_sde", DPM2MSDE = "k_dpmpp_2m_sde", DDIM = "ddim_v3",
}
export enum Noise { KARRAS = "karras", NATIVE = "native", EXPONENTIAL = "exponential", POLYEXPONENTIAL = "polyexponential" }
export enum EmotionOptions {
  NEUTRAL = "neutral", HAPPY = "happy", SAD = "sad", ANGRY = "angry", SCARED = "scared",
  SURPRISED = "surprised", TIRED = "tired", EXCITED = "excited", NERVOUS = "nervous",
  THINKING = "thinking", CONFUSED = "confused", SHY = "shy", DISGUSTED = "disgusted",
  SMUG = "smug", BORED = "bored", LAUGHING = "laughing", IRRITATED = "irritated",
  AROUSED = "aroused", EMBARRASSED = "embarrassed", WORRIED = "worried", LOVE = "love", DETERMINED = "determined", HURT = "hurt", PLAYFUL = "playful",
}
export type Resolution = `${"small" | "normal" | "large" | "wallpaper"}_${"portrait" | "landscape" | "square"}`;
export const RESOLUTION_DIMENSIONS: Partial<Record<Resolution, [number, number]>> = {
  small_portrait: [512, 768], small_landscape: [768, 512], small_square: [640, 640],
  normal_portrait: [832, 1216], normal_landscape: [1216, 832], normal_square: [1024, 1024],
  large_portrait: [1024, 1536], large_landscape: [1536, 1024], large_square: [1472, 1472],
  wallpaper_portrait: [1088, 1920], wallpaper_landscape: [1920, 1088],
};
export const Host = { WEB: "https://image.novelai.net" } as const;
export enum EventType { INTERMEDIATE = "intermediate", FINAL = "final" }
export type TagSuggestion = { tag: string; count?: number; confidence?: number };
export type ImageInput = Blob;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/^data:[^,]*,/, "")), c => c.charCodeAt(0));
}
export class Image {
  readonly data: Uint8Array;
  constructor(data: Uint8Array | string) { this.data = typeof data === "string" ? base64ToBytes(data) : data; }
  toDataURL() {
    const type = this.data[0] === 0xff ? "jpeg" : this.data[0] === 0x52 ? "webp" : "png";
    return `data:image/${type};base64,${bytesToBase64(this.data)}`;
  }
}
export type MsgpackEvent = { event_type: EventType; samp_ix: number; step_ix: number; image: Image };
export type GenerationPayload = { input: string; model: string; action: string; parameters: Record<string, unknown> };
