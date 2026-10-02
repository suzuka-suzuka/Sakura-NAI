import { Host, Model, EventType, EmotionOptions, bytesToBase64, base64ToBytes, Image, type ImageInput, type MsgpackEvent, type TagSuggestion } from "./protocol";
import { parseImage, prepareDirectorReference } from "./media";
import { NaiTransport } from "./transport";
import { queryAccount } from "./account";
import { buildPayload } from "./payload";
import { prepareInpainting } from "./image-input";
import { prepareFocusedInpainting } from "./focused-inpainting";
import { DEFAULT_SETTINGS, type GenerationSettings } from "./types";
import { isV4Model, isV5Model, supportsStreaming, type GenerationModel } from "./models";

// ---- Connection config (persisted in localStorage; the token never leaves the browser) ----

export type ConnectionConfig = {
  token: string;
  host: string;
  maxRetries: number;
  baseDelay: number;
};

const KEYS = {
  token: "nya-token",
  host: "nya-host",
  maxRetries: "nya-retry-max",
  baseDelay: "nya-retry-base",
} as const;

export const DEFAULT_CONNECTION: Omit<ConnectionConfig, "token"> = {
  host: Host.WEB,
  maxRetries: 3,
  baseDelay: 2000,
};

export function loadConnection(): ConnectionConfig | null {
  if (typeof localStorage === "undefined") return null;
  const token = localStorage.getItem(KEYS.token);
  if (!token) return null;
  return {
    token,
    host: localStorage.getItem(KEYS.host) || DEFAULT_CONNECTION.host,
    maxRetries: localStorage.getItem(KEYS.maxRetries) === null ? DEFAULT_CONNECTION.maxRetries : Number(localStorage.getItem(KEYS.maxRetries)),
    baseDelay: Number(localStorage.getItem(KEYS.baseDelay)) || DEFAULT_CONNECTION.baseDelay,
  };
}

export function saveConnection(cfg: ConnectionConfig) {
  localStorage.setItem(KEYS.token, cfg.token);
  localStorage.setItem(KEYS.host, cfg.host);
  localStorage.setItem(KEYS.maxRetries, String(cfg.maxRetries));
  localStorage.setItem(KEYS.baseDelay, String(cfg.baseDelay));
}

export function clearConnection() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}

// ---- Settings persistence ----
//
// Deliberately hand-rolled rather than zustand's `persist` middleware: the store is created at
// module scope under SSR, and `persist` rehydrates synchronously at creation, so the server HTML
// (defaults) and the first client render (restored) would disagree. Deferring the read into
// `init()` is the same pattern `loadConnection` already uses.

const SETTINGS_KEY = "nya-settings";

/** Reference images are dropped on save — see saveSettings. */
type PersistedSettings = Omit<GenerationSettings, "vibe" | "directorReference" | "imageSource">;

export function loadSettings(): GenerationSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    // Merged over the defaults so a field added to GenerationSettings later can never come back
    // as undefined from an older stored payload.
    const settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GenerationSettings>) };
    settings.characters = settings.characters.map(c => ({ ...c, id: c.id ?? crypto.randomUUID() }));
    return settings;
  } catch {
    return null;
  }
}

export function saveSettings(s: GenerationSettings) {
  if (typeof localStorage === "undefined") return;
  // `vibe` and `directorReference` each carry a full base64 payload *and* a preview data-URL, so a
  // handful of references blows the ~5MB quota. A QuotaExceededError here would take down
  // persistence of everything else — including the prompt — so dropping them is the correct
  // behaviour rather than a compromise.
  const { vibe: _v, directorReference: _d, imageSource: _i, ...rest } = s;
  const persisted: PersistedSettings = rest;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
  } catch {
    // Persistence the user never asked for must not interrupt them.
  }
}

const UI_KEY = "nya-ui";

export type UIPrefs = { settingsCollapsed: boolean; activeTab: "basic" | "advanced"; galleryOpen: boolean; combinedPrompts: boolean };

export function loadUIPrefs(): UIPrefs | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Old character-tab selections now open the combined prompt section.
    return { settingsCollapsed: !!saved.settingsCollapsed, activeTab: saved.activeTab === "advanced" ? "advanced" : "basic", galleryOpen: !!saved.galleryOpen, combinedPrompts: saved.combinedPrompts === true };
  } catch {
    return null;
  }
}

/**
 * Panel layout only. Notably absent: `focusedIndex` — restoring an open lightbox over an image the
 * user didn't ask to see is hostile — and `showConnect`, which is derived from whether a client exists.
 */
export function saveUIPrefs(p: UIPrefs) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p));
  } catch {
    /* non-essential */
  }
}

// ---- Application-owned request layer ----
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export type GenerateHandle = { seed: number; streaming: boolean; events: AsyncGenerator<MsgpackEvent> };

export class NaiClient {
  private readonly transport: NaiTransport;
  private readonly connection: ConnectionConfig;
  private readonly vibes = new Map<string, string>();
  private activeController?: AbortController;
  constructor(cfg: ConnectionConfig) { this.connection = { ...cfg }; this.transport = new NaiTransport(this.connection); }
  cancelGeneration() { this.activeController?.abort(); }

  async account() {
    return queryAccount(this.connection);
  }
  uncachedVibes(s: GenerationSettings) {
    if (s.imageSource?.mode === "infill" || isV5Model(s.model) || !isV4Model(s.model) || (s.model.includes("4-5") && s.directorReference.length)) return 0;
    return new Set(s.vibe.map(r => JSON.stringify([s.model, r.informationExtracted, r.base64])).filter(key => !this.vibes.has(key))).size;
  }
  async generate(settings: GenerationSettings, preview = true): Promise<GenerateHandle> {
    const seed = settings.seed >= 0 ? settings.seed : randomSeed();
    buildPayload(settings, seed); // Validate before allocating/decoding a resized image.
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const focused = await prepareFocusedInpainting(settings, controller.signal);
      const inpainting = focused ?? await prepareInpainting(settings, controller.signal);
      const prepared = inpainting.settings;
      controller.signal.throwIfAborted();
      const payload = buildPayload(prepared, seed);
      const streaming = preview && supportsStreaming(settings.model);
      if (!streaming) delete payload.parameters.stream;
      const events = this.generationEvents(settings, payload, streaming, controller, inpainting.compose);
      return { seed, streaming, events };
    } catch (error) {
      controller.abort();
      if (this.activeController === controller) this.activeController = undefined;
      throw error;
    }
  }

  private async *generationEvents(settings: GenerationSettings, payload: ReturnType<typeof buildPayload>, streaming: boolean, controller: AbortController, compose?: (url: string) => Promise<string>): AsyncGenerator<MsgpackEvent> {
    try {
      await this.addReferences(settings, payload.parameters, controller.signal);
      for await (const event of this.transport.generate(payload, streaming, controller.signal)) {
        yield compose ? { ...event, image: new Image(base64ToBytes((await compose(event.image.toDataURL())).split(",")[1])) } : event;
      }
    } finally {
      controller.abort();
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  private async addReferences(s: GenerationSettings, p: Record<string, unknown>, signal?: AbortSignal) {
    if (isV5Model(s.model) || s.imageSource?.mode === "infill") return;
    const director = (s.model === Model.V4_5 || s.model === Model.V4_5_CUR) && s.directorReference.length > 0;
    if (director) {
      p.director_reference_images = await Promise.all(s.directorReference.map(r => prepareDirectorReference(r.base64)));
      p.director_reference_descriptions = s.directorReference.map(() => ({ caption: { base_caption: "character", char_captions: [] }, legacy_uc: false }));
      p.director_reference_strength_values = s.directorReference.map(r => r.strength);
      p.director_reference_secondary_strength_values = s.directorReference.map(() => 1);
      p.director_reference_information_extracted = s.directorReference.map(r => r.informationExtracted);
    } else if (s.vibe.length) {
      const images: string[] = [];
      for (const ref of s.vibe) {
        if (!isV4Model(s.model)) { images.push(ref.base64); continue; }
        // Cache encoded vibes per connection, model, image and extraction amount.
        const key = JSON.stringify([s.model, ref.informationExtracted, ref.base64]);
        let encoded = this.vibes.get(key);
        if (!encoded) {
          const res = await this.transport.request("/ai/encode-vibe", { image: ref.base64, model: s.model, information_extracted: ref.informationExtracted }, signal, "application/octet-stream");
          encoded = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
          if (!encoded) throw new Error("The server returned an empty encoded vibe");
          if (this.vibes.size >= 32) this.vibes.delete(this.vibes.keys().next().value!);
          this.vibes.set(key, encoded);
        }
        images.push(encoded);
      }
      p.reference_image_multiple = images;
      p.reference_strength_multiple = s.vibe.map(r => r.strength);
      p.reference_information_extracted_multiple = s.vibe.map(r => r.informationExtracted);
    }
  }

  async suggestTags(prompt: string, model: GenerationModel = DEFAULT_SETTINGS.model): Promise<TagSuggestion[]> {
    const query = new URLSearchParams({ model, prompt, lang: "en" });
    const res = await this.transport.request(`/ai/generate-image/suggest-tags?${query}`);
    const data = await res.json() as { tags?: TagSuggestion[] } | TagSuggestion[];
    return Array.isArray(data) ? data : data.tags ?? [];
  }
  private async augment(img: ImageInput, req_type: string, extra: Record<string, unknown> = {}) {
    const { base64: image, width, height } = await parseImage(img);
    const images = await this.transport.images("/ai/augment-image", { image, width, height, req_type, ...extra });
    return images[images.length - 1];
  }
  lineArt = (img: ImageInput) => this.augment(img, "lineart");
  sketch = (img: ImageInput) => this.augment(img, "sketch");
  backgroundRemoval = (img: ImageInput) => this.augment(img, "bg-removal");
  async backgroundRemovalAll(img: ImageInput) {
    const { base64: image, width, height } = await parseImage(img);
    return this.transport.images("/ai/augment-image", { image, width, height, req_type: "bg-removal" });
  }
  declutter = (img: ImageInput) => this.augment(img, "declutter");
  colorize = (img: ImageInput, prompt = "", defry = 0) => this.augment(img, "colorize", { prompt, defry });
  changeEmotion = (img: ImageInput, emotion: EmotionOptions = EmotionOptions.NEUTRAL, prompt = "", level = 0) => this.augment(img, "emotion", { prompt: `${emotion};;${prompt}`, defry: level });
  async upscale(img: ImageInput) {
    const { base64: image, width, height } = await parseImage(img);
    if (width * height > 3145728) throw new Error("Upscale input must not exceed 3,145,728 pixels");
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ image: "image", model: "nai-diffusion-5-curated", declared_blur_sigma: 0 })], { type:"application/json" }));
    form.append("image", new Blob([new Uint8Array(base64ToBytes(image))], { type:"image/png" }), "image.png");
    return (await this.transport.images("/ai/upscale", form))[0];
  }
  async enhance(img: ImageInput, settings: GenerationSettings = DEFAULT_SETTINGS) {
    const parsed = await parseImage(img);
    const seed = settings.seed >= 0 ? settings.seed : randomSeed();
    const effective = { ...DEFAULT_SETTINGS, ...settings, imageSource: null, width: parsed.width, height: parsed.height, nSamples: 1 };
    const payload = buildPayload(effective, seed);
    payload.action = "img2img";
    delete payload.parameters.stream;
    Object.assign(payload.parameters, { image: parsed.base64, strength: 0.2, noise: 0, extra_noise_seed: seed, add_original_image: false });
    await this.addReferences(effective, payload.parameters);
    return this.transport.images("/ai/generate-image", payload);
  }
}
export { EventType, parseImage };
export type { Image, MsgpackEvent };
export async function parseReference(file: File | Blob) {
  const parsed = await parseImage(file);
  return { base64: parsed.base64, preview: `data:image/png;base64,${parsed.base64}` };
}
