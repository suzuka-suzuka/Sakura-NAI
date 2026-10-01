"use client";

import { translateUI } from "@/lib/i18n";
import { pixelSnap } from "@/lib/pixel-snap";
import { base64ToBytes, Image as NaiImage } from "@/lib/nai/protocol";
import { buildPayload } from "@/lib/nai/payload";
import { DEFAULT_PREFERENCES, loadGenerationPreferences, saveGenerationPreferences, estimateCost, type AccountInfo, type GenerationPreferences } from "@/lib/nai/cost";
import { create } from "zustand";
import { AccountQueryError } from "@/lib/nai/account";
import { toast } from "sonner";
import {
  NaiClient,
  EventType,
  loadConnection,
  saveConnection,
  clearConnection,
  loadSettings,
  saveSettings,
  loadUIPrefs,
  saveUIPrefs,
  type ConnectionConfig,
} from "@/lib/nai/client";
import { DEFAULT_SETTINGS, type GenerationSettings, type ReferenceImage, type CharacterSetting } from "@/lib/nai/types";
import { supportsStreaming, isV5Model, maxSamples } from "@/lib/nai/models";
import { CHARACTER_STARTERS, type CharacterKind } from "@/lib/nai/characters";
import { activeGenerationSettings, enhanceFactors, ENHANCE_LEVELS, imageToolOutputSize, type Enhancement } from "@/lib/nai/image-tools";
import type { EmotionOptions, Image } from "@/lib/nai/protocol";
import {
  loadImages,
  saveImage,
  deleteImage as dbDelete,
  clearImages,
  type GalleryImage,
} from "@/lib/db/gallery";

export type SettingsTab = "basic" | "advanced";

type RestoreSettingsOptions = {
  message?: string;
  /** A stable id lets rapid gallery browsing update one Undo toast instead of stacking many. */
  toastId?: string;
};

export type StreamTile = {
  sampleIndex: number;
  dataUrl: string | null;
  stepIndex: number;
  progress: number; // 0..1
  status: "initializing" | "generating" | "done";
};

type ReferenceField = "vibe" | "directorReference";

export type DirectorKind =
  | "lineArt"
  | "sketch"
  | "backgroundRemoval"
  | "declutter"
  | "colorize"
  | "emotion"
  | "upscale"
  | "pixelSnap"
  | "enhance";

export type DirectorOpts = { prompt?: string; defry?: number; emotion?: EmotionOptions; level?: number; source?: GalleryImage; colors?: number; conservative?: boolean; upscale?: boolean; scale?: 2 | 4 };

type Store = {
  // ---- connection ----
  connection: ConnectionConfig | null;
  client: NaiClient | null;
  /** Only a verified account resolves true. Other outcomes stay visible in the connection form. */
  connect: (cfg: ConnectionConfig) => Promise<boolean>;
  connectionStatus: "idle" | "verifying" | "ok" | "invalid" | "unknown";
  connectionError: string | null;
  disconnect: () => void;

  // ---- settings ----
  settings: GenerationSettings;
  patchSettings: (patch: Partial<GenerationSettings>) => void;
  resetSettings: () => void;
  restoreSettings: (s: GenerationSettings, options?: RestoreSettingsOptions) => void;
  enhancement: Enhancement | null;
  beginEnhancement: (source: GalleryImage) => void;
  patchEnhancement: (patch: Partial<Omit<Enhancement, "source">>) => void;
  closeEnhancement: () => void;
  addCharacter: (kind?: CharacterKind) => void;
  updateCharacter: (i: number, patch: Partial<CharacterSetting>) => void;
  removeCharacter: (i: number) => void;
  moveCharacter: (from: number, to: number) => void;
  addReference: (field: ReferenceField, ref: ReferenceImage) => void;
  updateReference: (field: ReferenceField, i: number, patch: Partial<ReferenceImage>) => void;
  removeReference: (field: ReferenceField, i: number) => void;

  // ---- gallery ----
  images: GalleryImage[];
  /** Distinguishes first-paint, genuinely empty, and IDB-unavailable — they used to render alike. */
  galleryStatus: "loading" | "ready" | "error";
  galleryError: string | null;
  selectedBatch: GalleryImage[] | null;
  selectedImage: GalleryImage | null;
  loadGallery: () => Promise<void>;
  selectBatch: (batchId: number, loadRecipe?: boolean) => void;
  selectImage: (img: GalleryImage, loadRecipe?: boolean) => void;
  deleteImage: (id: number) => Promise<void>;
  clearGallery: () => Promise<void>;

  // ---- generation ----
  preferences: GenerationPreferences;
  patchPreferences: (patch: Partial<GenerationPreferences>) => void;
  account: AccountInfo | null;
  accountLoading: boolean;
  refreshAccount: () => Promise<void>;
  isPreparing: boolean;
  paidAcknowledged: boolean;
  pendingPayment: { settings: GenerationSettings; cost: number; client: NaiClient } | null;
  confirmPayment: () => Promise<void>;
  cancelPayment: () => void;
  runSettings: GenerationSettings | null;
  runPreview: boolean;
  isGenerating: boolean;
  streamingBatch: StreamTile[] | null;
  /** Last failure, kept so the canvas can explain it after the toast fades. */
  lastError: { message: string; at: number; settings?: GenerationSettings } | null;
  abortRequested: boolean;
  /** False when the current request returns only final images. */
  canCancelGeneration: boolean;
  /** Wall-clock start of the current run, so waits can show elapsed time instead of a frozen ring. */
  runStartedAt: number | null;
  generate: (approved?: { settings: GenerationSettings; cost: number }, submitted?: GenerationSettings) => Promise<void>;
  cancelGenerate: () => void;
  clearError: () => void;

  // ---- director tools ----
  isDirectorProcessing: boolean;
  directorKind: DirectorKind | null;
  runDirector: (kind: DirectorKind, opts?: DirectorOpts) => Promise<void>;

  // ---- ui ----
  settingsCollapsed: boolean;
  activeTab: SettingsTab;
  galleryOpen: boolean;
  combinedPrompts: boolean;
  negativePromptActive: boolean;
  showConnect: boolean;
  showDirector: boolean;
  showPositions: boolean;
  imageEditor: { mode: "draw" | "mask"; source: string | null } | null;
  focusedIndex: number | null;
  setUI: (
    patch: Partial<
      Pick<
        Store,
        "settingsCollapsed" | "activeTab" | "galleryOpen" | "combinedPrompts" | "negativePromptActive" | "showConnect" | "showDirector" | "focusedIndex" | "showPositions" | "imageEditor"
      >
    >,
  ) => void;

  // ---- lifecycle ----
  init: () => Promise<void>;
};

let accountRequest: { client: NaiClient; promise: Promise<void> } | null = null;

export const useStore = create<Store>()((set, get) => ({
  // ---- connection ----
  connection: null,
  client: null,
  connectionStatus: "idle",
  connectionError: null,
  connect: async (cfg) => {
    cfg = { ...cfg, host: cfg.host.trim().replace(/\/+$/, ""), token: cfg.token.trim() };
    const client = new NaiClient(cfg);
    set({ connection: cfg, client, account: null, paidAcknowledged: false, pendingPayment: null, connectionStatus: "verifying", connectionError: null });
    await get().refreshAccount();
    // An older request must not save credentials or close a newer connection attempt.
    if (get().client !== client) return false;
    saveConnection(cfg);
    const verified = get().connectionStatus === "ok";
    if (verified) set({ showConnect: false });
    return verified;
  },
  disconnect: () => {
    clearConnection();
    set({ connection: null, client: null, account: null, accountLoading: false, paidAcknowledged: false, pendingPayment: null, connectionStatus: "idle", connectionError: null });
  },

  // ---- settings ----
  settings: DEFAULT_SETTINGS,
  enhancement: null,
  beginEnhancement: (source) => {
    const factors = enhanceFactors(source, get().settings.model);
    set({ enhancement: { source: structuredClone(source), factor: factors[factors.length - 1], magnitude: 3, ...ENHANCE_LEVELS[2], advanced: false }, lastError: null });
  },
  patchEnhancement: (patch) => set(s => {
    if (!s.enhancement) return {};
    const magnitude = Math.min(5, Math.max(1, Math.round(patch.magnitude ?? s.enhancement.magnitude)));
    return { enhancement: { ...s.enhancement, ...patch, magnitude,
      ...(patch.magnitude !== undefined ? ENHANCE_LEVELS[magnitude - 1] : {}) } };
  }),
  closeEnhancement: () => set({ enhancement: null }),
  patchSettings: (patch) => set((s) => {
    const settings = { ...s.settings, ...patch };
    if (isV5Model(settings.model)) {
      settings.nSamples = Math.min(settings.nSamples, maxSamples(settings.model, settings.width, settings.height));
      if (settings.sampler === "ddim_v3") settings.sampler = DEFAULT_SETTINGS.sampler;
    }
    return { settings };
  }),
  resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
  restoreSettings: (snapshot, options) => {
    // This replaces the prompt, the negative prompt, every character and every uploaded reference.
    // Its call sites are ~28px glyphs on hover overlays sitting one gap away from "copy seed" —
    // same visual weight, wildly different blast radius — so it needs the same undo affordance
    // deleteImage already has.
    const prev = get().settings;
    const hadWork =
      prev.prompt.trim() !== "" ||
      prev.negativePrompt.trim() !== "" ||
      prev.characters.length > 0 ||
      prev.vibe.length > 0 ||
      prev.directorReference.length > 0;

    set({ settings: { ...DEFAULT_SETTINGS, ...snapshot } });
    toast.success(options?.message ?? translateUI("Restored — seed {0}, {1} steps", snapshot.seed, snapshot.steps), {
      id: options?.toastId,
      // Only offered when something was actually overwritten. On a fresh form — the common case
      // while browsing the gallery — restoring is harmless, and an Undo there is noise that
      // teaches people to ignore it.
      ...(hadWork
        ? { duration: 6000, action: { label: translateUI("Undo"), onClick: () => set({ settings: prev }) } }
        : {}),
    });
  },
  addCharacter: (kind = "other") =>
    set((s) => ({
      settings: {
        ...s.settings,
        characters: [
          ...s.settings.characters.map(c => ({ ...c, collapsed: true })),
          { id: crypto.randomUUID(), prompt: CHARACTER_STARTERS[kind], uc: "", center: { x: 0.5, y: 0.5 }, enabled: true, collapsed: false },
        ],
      },
    })),
  updateCharacter: (i, patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        characters: s.settings.characters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
      },
    })),
  removeCharacter: (i) =>
    set((s) => ({
      settings: { ...s.settings, characters: s.settings.characters.filter((_, idx) => idx !== i) },
    })),
  moveCharacter: (from, to) => set(s => {
    const characters = [...s.settings.characters];
    if (from < 0 || to < 0 || from >= characters.length || to >= characters.length) return {};
    const [character] = characters.splice(from, 1);
    characters.splice(to, 0, character);
    return { settings: { ...s.settings, characters } };
  }),
  addReference: (field, ref) =>
    set((s) => ({ settings: { ...s.settings, [field]: [...s.settings[field], ref] } })),
  updateReference: (field, i, patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        [field]: s.settings[field].map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
      },
    })),
  removeReference: (field, i) =>
    set((s) => ({
      settings: { ...s.settings, [field]: s.settings[field].filter((_, idx) => idx !== i) },
    })),

  // ---- gallery ----
  images: [],
  galleryStatus: "loading",
  galleryError: null,
  selectedBatch: null,
  selectedImage: null,
  loadGallery: async () => {
    set({ galleryStatus: "loading", galleryError: null });
    try {
      const images = await loadImages();
      set({ images, galleryStatus: "ready" });
      if (images.length > 0) get().selectBatch(images[0].batchId);
    } catch (e) {
      // Swallowing this used to leave images: [], telling a returning user whose storage failed
      // that they had never generated anything.
      console.error(translateUI("Failed to load gallery"), e);
      set({ galleryStatus: "error", galleryError: e instanceof Error ? e.message : String(e) });
    }
  },
  selectBatch: (batchId, loadRecipe = false) => {
    const { images } = get();
    const batch = images.filter((i) => i.batchId === batchId).sort((a, b) => a.batchIndex - b.batchIndex);
    if (batch.length) {
      set({ selectedBatch: batch, selectedImage: batch[0], focusedIndex: null, enhancement: null });
      if (loadRecipe) {
        get().restoreSettings(batch[0].settings, {
          message: translateUI("Recipe loaded from gallery — seed {0}", batch[0].seed),
          toastId: "recipe-loaded",
        });
      }
    }
  },
  selectImage: (img, loadRecipe = false) => {
    set({ selectedImage: img, enhancement: null });
    if (loadRecipe) {
      get().restoreSettings(img.settings, {
        message: translateUI("Recipe loaded from gallery — seed {0}", img.seed),
        toastId: "recipe-loaded",
      });
    }
  },
  deleteImage: async (id) => {
    // Optimistic: drop from view immediately, hold the record in memory, and only touch IndexedDB
    // once the undo window closes. A misclick otherwise destroys an unreproducible image.
    const doomed = get().images.find((i) => i.id === id);
    if (!doomed) return;

    const prevImages = get().images;
    const prevBatch = get().selectedBatch;
    const prevSelected = get().selectedImage;

    const images = prevImages.filter((i) => i.id !== id);
    set({ images, ...(get().enhancement?.source.dataUrl === doomed.dataUrl ? { enhancement: null } : {}) });
    if (prevBatch) {
      const batch = prevBatch.filter((i) => i.id !== id);
      if (batch.length) {
        // Hold your place. This used to snap to batch[0] after every removal, so culling a batch
        // of 8 down to 1 meant delete → lose the image you were judging → navigate back → repeat.
        // If the selection survived, keep it; otherwise take the neighbour that slid into the
        // deleted slot.
        const stillThere = prevSelected && batch.some((i) => i.id === prevSelected.id);
        const deletedAt = prevBatch.findIndex((i) => i.id === id);
        const next = stillThere
          ? prevSelected
          : batch[Math.min(Math.max(deletedAt, 0), batch.length - 1)];
        set({ selectedBatch: batch, selectedImage: next });
      } else if (images.length) get().selectBatch(images[0].batchId);
      else set({ selectedBatch: null, selectedImage: null });
    }

    // Undo re-inserts this one image at its original index rather than restoring a whole array
    // snapshot. Each delete used to close over its own copy of `images`, so two deletes inside the
    // 6s window left two stale closures — undoing the first resurrected the second deleted image
    // and orphaned its pending dbDelete, leaving a phantom that reappeared on reload.
    const imageIndex = prevImages.findIndex((i) => i.id === id);
    const batchIndex = prevBatch?.findIndex((i) => i.id === id) ?? -1;
    const reinsert = <T extends { id?: number }>(list: T[], item: T, at: number) => {
      const copy = list.slice();
      copy.splice(Math.min(Math.max(at, 0), copy.length), 0, item);
      return copy;
    };

    let undone = false;
    toast(translateUI("Image deleted"), {
      duration: 6000,
      action: {
        label: translateUI("Undo"),
        onClick: () => {
          undone = true;
          set((s) => ({
            images: reinsert(s.images, doomed, imageIndex),
            selectedBatch:
              s.selectedBatch && batchIndex >= 0
                ? reinsert(s.selectedBatch, doomed, batchIndex)
                : s.selectedBatch,
            selectedImage: doomed,
          }));
        },
      },
      onAutoClose: () => {
        if (!undone) void dbDelete(id);
      },
      onDismiss: () => {
        if (!undone) void dbDelete(id);
      },
    });
  },
  clearGallery: async () => {
    // clearImages() throws on quota, private browsing and corruption. Unhandled, the confirm modal
    // closed as if it had worked while every image was still there — loadGallery already treats
    // exactly this failure as worth a dedicated error state, so route into the same one.
    const n = get().images.length;
    try {
      await clearImages();
      set({ images: [], selectedBatch: null, selectedImage: null, enhancement: null });
      toast.success(translateUI("Deleted {0} image{1}", n, n === 1 ? "" : "s"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(translateUI("Failed to clear gallery"), e);
      set({ galleryStatus: "error", galleryError: message });
      toast.error(translateUI("Couldn't delete your images: {0}", message));
    }
  },

  // ---- generation ----
  preferences: DEFAULT_PREFERENCES,
  patchPreferences: (patch) => {
    const preferences = { ...get().preferences, ...patch };
    set({ preferences }); saveGenerationPreferences(preferences);
  },
  account: null,
  accountLoading: false,
  refreshAccount: async () => {
    const client = get().client;
    if (!client) return;
    if (accountRequest?.client === client) return accountRequest.promise;
    set({ accountLoading: true });
    const promise = (async () => {
      try {
        const account = await client.account();
        if (get().client === client) set({ account, connectionStatus: "ok", connectionError: null });
      } catch (error) {
        if (get().client === client) {
          const invalid = error instanceof AccountQueryError && error.status === 401;
          const running = get().isGenerating || get().isDirectorProcessing;
          set({ account: null, connectionStatus: invalid ? "invalid" : "unknown",
            connectionError: error instanceof AccountQueryError ? error.message : "Cannot reach the server. Check the address, network and allowed origins.",
            ...(invalid ? { pendingPayment: null, ...(!running ? { client: null, showConnect: true } : {}) } : {}),
          });
        }
      } finally {
        if (get().client === client || (accountRequest?.client === client && !get().client)) set({ accountLoading: false });
        if (accountRequest?.client === client) accountRequest = null;
      }
    })();
    accountRequest = { client, promise };
    return promise;
  },
  isPreparing: false,
  paidAcknowledged: false,
  pendingPayment: null,
  cancelPayment: () => set({ pendingPayment: null }),
  confirmPayment: async () => {
    const pending = get().pendingPayment;
    if (!pending || get().client !== pending.client) { set({ pendingPayment: null }); return; }
    set({ pendingPayment: null });
    await get().generate({ settings: pending.settings, cost: pending.cost });
  },
  runSettings: null,
  runPreview: true,
  isGenerating: false,
  streamingBatch: null,
  lastError: null,
  abortRequested: false,
  canCancelGeneration: false,
  runStartedAt: null,
  cancelGenerate: () => {
    const { isGenerating, canCancelGeneration } = get();
    if (!isGenerating) return;
    if (!canCancelGeneration) {
      toast.info(translateUI("Final-only generations cannot be stopped after submission."));
      return;
    }
    set({ abortRequested: true });
    get().client?.cancelGeneration();
  },
  clearError: () => set({ lastError: null }),
  generate: async (approved, submitted) => {
    const { client } = get();
    const settings = structuredClone(approved?.settings ?? submitted ?? activeGenerationSettings(get().settings, get().enhancement));
    if (get().isGenerating || get().isPreparing || get().isDirectorProcessing || get().pendingPayment) return;
    if (!client || get().connectionStatus === "invalid") {
      set({ showConnect: true });
      return;
    }
    // An empty prompt is a real, billed request that returns noise. Characters count as intent —
    // a V4 prompt can legitimately live entirely in the character list.
    const hasIntent =
      settings.prompt.trim().length > 0 ||
      settings.characters.some((c) => c.enabled && c.prompt.trim().length > 0) || !!settings.imageSource;
    if (!hasIntent) {
      toast.error(translateUI("Describe something first — an empty prompt still costs Anlas."));
      set({ settingsCollapsed: false, activeTab: "basic" });
      return;
    }
    set({ isPreparing: true });
    try {
      buildPayload(settings, settings.seed >= 0 ? settings.seed : 0);
      // Refresh before a request so exhausted V5 allowance cannot silently retain a 0-point label.
      await get().refreshAccount();
      if (get().client !== client) return;
      const estimate = estimateCost(settings, get().account, client.uncachedVibes(settings));
      if (!estimate.valid) throw new Error(translateUI("This resolution and step count exceed the per-image cost limit. Reduce either setting."));
      const cost = estimate.total;
      if (get().preferences.confirmPaid && cost > 0 &&
          ((!get().paidAcknowledged && approved === undefined) || (approved !== undefined && cost > approved.cost))) {
        set({ pendingPayment: { settings: structuredClone(settings), cost, client } });
        return;
      }
      set({ paidAcknowledged: cost > 0 });
    } catch (e) {
      toast.error(translateUI("Generation failed: {0}", e instanceof Error ? e.message : String(e)));
      return;
    } finally { set({ isPreparing: false }); }
    const preview = get().preferences.streamPreview;
    const n = Math.max(1, settings.nSamples);
    const canCancelGeneration = preview && supportsStreaming(settings.model);
    const compactLayout = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
    // Deliberately does NOT clear selectedBatch/selectedImage: the success path below overwrites
    // them anyway, and keeping them means a failed run leaves the user's previous image intact
    // instead of dumping them on the first-run empty state.
    set({
      isGenerating: true,
      enhancement: null,
      runSettings: structuredClone(settings),
      runPreview: preview,
      lastError: null,
      abortRequested: false,
      canCancelGeneration,
      runStartedAt: Date.now(),
      // On compact layouts the composer is a drawer over the canvas. Committing the prompt should
      // reveal streaming immediately; the persistent desktop composer stays exactly where it is.
      ...(compactLayout ? { settingsCollapsed: true } : {}),
      streamingBatch: Array.from({ length: n }, (_, i) => ({
        sampleIndex: i,
        dataUrl: null,
        stepIndex: 0,
        progress: 0,
        status: "initializing" as const,
      })),
    });

    // Declared outside the try so the catch can still reach them: a run that dies mid-stream has
    // to be able to persist the samples that already finished.
    const finals: { dataUrl: string; sampleIndex: number }[] = [];
    const batchId = Date.now();
    let baseSeed = 0;

    // Persist whatever finished and reveal it. Called from both the success tail and the catch.
    const commit = async (): Promise<GalleryImage[]> => {
      if (!finals.length) return [];
      const ordered = finals.slice().sort((a, b) => a.sampleIndex - b.sampleIndex);
      const saved = await Promise.all(
        ordered.map(async (f, i) => {
          // Per-image seed, not the batch base seed — otherwise "Use these settings" on image #3
          // silently restores image #1's recipe while the toolbar chip shows the correct seed.
          const img: GalleryImage = {
            dataUrl: f.dataUrl,
            timestamp: new Date().toISOString(),
            filename: `sakura_${batchId}_${i + 1}.png`,
            seed: (baseSeed + f.sampleIndex) >>> 0,
            settings: { ...settings, ...imageToolOutputSize(settings), seed: (baseSeed + f.sampleIndex) >>> 0,
              imageSource: settings.imageSource?.upscaledEnhance ? null : settings.imageSource },
            batchId,
            batchIndex: i,
            batchSize: ordered.length,
          };
          img.id = await saveImage(img);
          return img;
        }),
      );

      set((s) => ({ images: [...saved.slice().reverse(), ...s.images] }));
      // The gallery is an overlay below 1280px. Opening it here would cover the result at the exact
      // moment it resolves; on wide layouts it remains a useful persistent confirmation/history.
      const compact = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
      set({ selectedBatch: saved, selectedImage: saved[0], galleryOpen: !compact });
      return saved;
    };

    try {
      const { seed, streaming, events } = await client.generate(settings, preview);
      baseSeed = seed;

      for await (const ev of events) {
        // Closing the iterator also releases the response reader.
        if (streaming && get().abortRequested) break;
        if (ev.event_type === EventType.INTERMEDIATE && preview) {
          set((s) => ({
            streamingBatch:
              s.streamingBatch?.map((t) =>
                t.sampleIndex === ev.samp_ix
                  ? {
                      ...t,
                      dataUrl: ev.image.toDataURL(),
                      stepIndex: ev.step_ix,
                      progress: Math.min(1, ev.step_ix / settings.steps),
                      status: "generating",
                    }
                  : t,
              ) ?? null,
          }));
        } else if (ev.event_type === EventType.FINAL) {
          // The tile must adopt the FINAL image, not keep the last INTERMEDIATE. Previously the
          // frame that un-blurred on completion was the penultimate latent — legible only
          // *because* it was blurred — which then swapped to a different image once the batch
          // committed. And a stream that emits no intermediates at all left dataUrl null while
          // status flipped to "done", stranding the tile on a shimmer that never resolved.
          const dataUrl = ev.image.toDataURL();
          finals.push({ dataUrl, sampleIndex: ev.samp_ix });
          set((s) => ({
            streamingBatch:
              s.streamingBatch?.map((t) =>
                t.sampleIndex === ev.samp_ix ? { ...t, dataUrl: preview ? dataUrl : null, progress: 1, status: "done" } : t,
              ) ?? null,
          }));
        }
      }

      const saved = await commit();

      if (get().abortRequested) {
        toast(saved.length ? translateUI("Stopped — kept {0} finished image{1}", saved.length, saved.length > 1 ? "s" : "") : translateUI("Stopped"));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(translateUI("Generation failed"), e);

      // Samples that already finished are paid for and unreproducible, so a late failure must not
      // discard them — the abort path above already keeps them, and diverging here was the bug.
      // Persisting is best-effort: a save failure must not mask the error that actually broke the run.
      let rescued: GalleryImage[] = [];
      try {
        rescued = await commit();
      } catch (saveErr) {
        console.error(translateUI("Could not persist images from the failed run"), saveErr);
      }

      if (get().abortRequested) {
        toast(rescued.length ? translateUI("Stopped — kept {0} finished image{1}", rescued.length, rescued.length > 1 ? "s" : "") : translateUI("Stopped"));
      } else if (rescued.length) {
        // Not an ErrorState: there are images on screen. A full-canvas error card would cover
        // the very thing that survived.
        toast.error(translateUI("Run failed — kept {0} finished image{1}", rescued.length, rescued.length > 1 ? "s" : ""));
      } else {
        set({ lastError: { message, at: Date.now(), settings: structuredClone(settings) } });
        toast.error(translateUI("Generation failed: {0}", message));
      }
    } finally {
      set({
        isGenerating: false,
        streamingBatch: null,
        abortRequested: false,
        canCancelGeneration: false,
        runStartedAt: null,
        runSettings: null,
      });
      void get().refreshAccount();
    }
  },

  // ---- director tools ----
  isDirectorProcessing: false,
  directorKind: null,
  runDirector: async (kind, opts) => {
    const { client } = get();
    const selectedImage = opts?.source ?? get().selectedImage;
    if (get().isDirectorProcessing || get().isGenerating || get().isPreparing) return;
    if ((!client || get().connectionStatus === "invalid") && kind !== "pixelSnap") {
      set({ showConnect: true });
      return;
    }
    if (!selectedImage) {
      toast.error(translateUI("Select an image first"));
      return;
    }
    set({ isDirectorProcessing: true, directorKind: kind, lastError: null });
    try {
      const blob = await (await fetch(selectedImage.dataUrl)).blob();
      let results: Image[];
      switch (kind) {
        case "lineArt": results = [await client!.lineArt(blob)]; break;
        case "sketch": results = [await client!.sketch(blob)]; break;
        case "backgroundRemoval": results = await client!.backgroundRemovalAll(blob); break;
        case "declutter": results = [await client!.declutter(blob)]; break;
        case "colorize": results = [await client!.colorize(blob, opts?.prompt, opts?.defry)]; break;
        case "emotion": results = [await client!.changeEmotion(blob, opts?.emotion, opts?.prompt, opts?.level)]; break;
        case "upscale": results = [await client!.upscale(blob)]; break;
        case "enhance": results = await client!.enhance(blob, selectedImage.settings); break;
        case "pixelSnap": results = [new NaiImage(base64ToBytes((await pixelSnap(selectedImage.dataUrl, opts ?? {})).split(",")[1]))]; break;
        default: results = [];
      }
      if (!results.length) return;

      const batchId = Date.now();
      const saved: GalleryImage[] = [];
      for (let i = 0; i < results.length; i++) {
        const dataUrl = results[i].toDataURL();
        const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
        const dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close();
        const img: GalleryImage = {
          dataUrl,
          timestamp: new Date().toISOString(),
          filename: `sakura_${kind}_${batchId}_${i + 1}.png`,
          seed: selectedImage.seed,
          settings: { ...selectedImage.settings, ...dimensions, imageSource: null },
          batchId,
          batchIndex: i,
          batchSize: results.length,
          processedWith: kind,
        };
        const id = await saveImage(img);
        img.id = id;
        saved.push(img);
      }
      set((s) => ({
        images: [...saved.slice().reverse(), ...s.images],
        selectedBatch: saved,
        selectedImage: saved[0],
        galleryOpen: !(typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches),
        showDirector: kind !== "upscale" && kind !== "enhance",
      }));
      toast.success(translateUI("Applied director tool"));
      if (kind !== "pixelSnap") void get().refreshAccount();
    } catch (e) {
      console.error(translateUI("Director tool failed"), e);
      toast.error(translateUI("Director tool failed: {0}", e instanceof Error ? e.message : String(e)));
    } finally {
      set({ isDirectorProcessing: false, directorKind: null });
    }
  },

  // ---- ui ----
  settingsCollapsed: false,
  activeTab: "basic",
  galleryOpen: false,
  combinedPrompts: false,
  negativePromptActive: false,
  showConnect: false,
  showDirector: false,
  showPositions: false,
  imageEditor: null,
  focusedIndex: null,
  setUI: (patch) => set(patch),

  // ---- lifecycle ----
  init: async () => {
    const cfg = loadConnection();
    // The recipe is the one piece of state the user actually authored, and it was the only thing
    // init() didn't restore — so ⌘R wiped it, one key away from the ⌘↵ generate gesture.
    set({ preferences: loadGenerationPreferences() });
    const savedSettings = loadSettings();
    if (savedSettings) set({ settings: savedSettings });
    const savedUI = loadUIPrefs();
    if (savedUI) set(savedUI);

    if (cfg) {
      set({ connection: cfg, client: new NaiClient(cfg), account: null, connectionStatus: "verifying", connectionError: null });
      await Promise.all([get().refreshAccount(), get().loadGallery()]);
      return;
    } else {
      set({ showConnect: true });
    }
    await get().loadGallery();
  },
}));

// Persist the recipe and the panel layout. Debounced rather than per-keystroke — typing a prompt
// would otherwise serialise the whole settings object on every character.
if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: GenerationSettings | null = null;
  let lastUI = "";

  useStore.subscribe((s) => {
    const uiKey = `${s.settingsCollapsed}|${s.activeTab}|${s.galleryOpen}|${s.combinedPrompts}`;
    if (s.settings === last && uiKey === lastUI) return;
    last = s.settings;
    lastUI = uiKey;
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveSettings(s.settings);
      saveUIPrefs({
        settingsCollapsed: s.settingsCollapsed,
        activeTab: s.activeTab,
        galleryOpen: s.galleryOpen,
        combinedPrompts: s.combinedPrompts,
      });
    }, 400);
  });
}

// One acknowledgement per paid episode. Any return to a known 0-point setup re-arms it,
// whether caused by a form edit, recipe restore, or refreshed account allowance.
useStore.subscribe((s) => {
  if (!s.paidAcknowledged) return;
  const settings = activeGenerationSettings(s.settings, s.enhancement);
  if (estimateCost(settings, s.account, s.client?.uncachedVibes(settings) ?? settings.vibe.length).total === 0) {
    useStore.setState({ paidAcknowledged: false });
  }
});
