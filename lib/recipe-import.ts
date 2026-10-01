"use client";

import { translateUI } from "@/lib/i18n";
import { toast } from "sonner";
import { useStore } from "./store";
import { Model } from "./nai/protocol";
import { generationSize } from "./nai/models";
import type { ImportedRecipe } from "./nai/import-recipe";

export type ImageImportPurpose = "recipe" | "img2img" | "vibe" | "directorReference";
export type ImageImportCandidate = {
  filename: string;
  base64: string;
  preview: string;
  width: number;
  height: number;
  recipe: ImportedRecipe | null;
  metadataError: boolean;
};

const DROP_TOAST_ID = "image-drop-import";
let dropRequest = 0;

function dropImportBlocked() {
  const s = useStore.getState();
  return s.isGenerating || s.isPreparing || s.isDirectorProcessing || !!s.imageEditor || !!s.pendingPayment || s.showConnect || s.showDirector;
}

/** Read a dropped image without changing settings. Fixed-purpose file pickers keep their own paths. */
export async function prepareImageImport(file: File | null | undefined): Promise<boolean> {
  if (!file || dropImportBlocked()) return false;
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)) {
    toast.error(translateUI("Choose an image file."));
    return false;
  }

  const request = ++dropRequest;
  toast.loading(translateUI("Reading image and generation metadata…"), { id: DROP_TOAST_ID });
  try {
    // Read metadata from the original bytes: canvas re-encoding removes PNG text and stealth data.
    const { extractImageMetadata, parseImage } = await import("@/lib/nai/media");
    const [parsed, metadata] = await Promise.all([
      parseImage(file),
      extractImageMetadata(file).catch(() => null),
    ]);
    let recipe: ImportedRecipe | null = null;
    let metadataError = metadata === null;
    if (metadata?.type === "NOVELAI" && metadata.entries.length) {
      try {
        const { recipeFromNovelAIMetadata } = await import("@/lib/nai/import-recipe");
        const restored = recipeFromNovelAIMetadata(metadata.entries, parsed);
        // Image dimensions are filled in by the parser even when only the NovelAI software
        // marker exists. That marker alone does not mean generation parameters were embedded.
        if (restored.importedFields.some(field => field !== "resolution")) recipe = restored;
      } catch {
        // A valid image remains usable as a base or reference even with broken metadata.
        metadataError = true;
      }
    }
    if (request !== dropRequest) return false;
    toast.dismiss(DROP_TOAST_ID);
    if (dropImportBlocked()) return false;
    useStore.getState().setUI({ imageImport: {
      filename: file.name, ...parsed, preview: `data:image/png;base64,${parsed.base64}`, recipe, metadataError,
    } });
    return true;
  } catch (error) {
    if (request !== dropRequest) return false;
    toast.error(error instanceof Error ? error.message : translateUI("The image could not be read."), { id: DROP_TOAST_ID });
    return false;
  }
}

/** Apply the selected purpose; references append to the chosen list and select V4.5 Full. */
export function applyImageImport(purpose: ImageImportPurpose): boolean {
  const store = useStore.getState();
  const image = store.imageImport;
  if (!image || dropImportBlocked()) return false;
  if (purpose === "recipe") {
    if (!image.recipe) return false;
    store.restoreSettings(image.recipe.settings, {
      message: translateUI("Imported {0} recipe fields from {1}", image.recipe.importedFields.length, image.filename),
      toastId: DROP_TOAST_ID,
    });
    if (image.recipe.omittedReferences) {
      toast.warning(translateUI("Reference strengths were found, but source reference images are not embedded in NovelAI PNGs."));
    }
  } else if (purpose === "img2img") {
    store.patchSettings({ ...generationSize(image.width, image.height), imageSource: {
      dataUrl: image.preview, width: image.width, height: image.height,
      mode: "img2img", strength: 0.7, noise: 0, inpaintStrength: 1,
    } });
    const settings = structuredClone(useStore.getState().settings);
    const imported = {
      dataUrl: image.preview, settings: { ...settings, width: image.width, height: image.height },
      filename: image.filename, seed: -1, timestamp: new Date().toISOString(),
      batchId: Date.now(), batchIndex: 0, batchSize: 1,
    };
    useStore.setState({ selectedImage: imported, selectedBatch: [imported], lastError: null });
    toast.success(translateUI("Imported {0} as a base image. Your prompt and settings were kept.", image.filename), { id: DROP_TOAST_ID });
  } else {
    store.patchSettings({ model: Model.V4_5, [purpose]: [...store.settings[purpose], {
      base64: image.base64, preview: image.preview, strength: 0.6, informationExtracted: 1,
    }] });
    toast.success(translateUI(purpose === "vibe"
      ? "Added {0} for Vibe Transfer. Model switched to V4.5 Full."
      : "Added {0} as a character reference. Model switched to V4.5 Full.", image.filename), { id: DROP_TOAST_ID });
  }
  store.closeEnhancement();
  store.setUI({ imageImport: null, activeTab: "basic", settingsCollapsed: false, focusedIndex: null, showPositions: false });
  return true;
}

/**
 * Import a NovelAI PNG recipe into the composer.
 *
 * The generic file picker restores metadata or uses ordinary images as a base.
 * Drag-and-drop uses prepareImageImport instead so users can choose a purpose first.
 *
 * Returns whether the recipe was applied, so callers can decide what to do with focus afterwards.
 */
export async function importRecipeFile(file: File | null | undefined): Promise<boolean> {
  if (!file) return false;
  const state = useStore.getState();
  if (state.isGenerating || state.isPreparing || state.isDirectorProcessing || state.imageEditor) return false;

  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)) {
    toast.error(translateUI("Choose an image file."));
    return false;
  }

  const { restoreSettings, setUI } = useStore.getState();
  // One toast id for the whole operation: the success and error toasts below reuse it, so each
  // replaces this spinner in place rather than stacking a second card next to it. Nothing dismisses
  // it explicitly — a dismiss here would race the replacement and blank the result.
  const TOAST_ID = "recipe-import";
  toast.loading(translateUI("Reading generation metadata…"), { id: TOAST_ID });

  try {
    // PNG/EXIF/stealth decoders are substantial and only needed after this deliberate gesture.
    // Keep them out of the initial studio bundle.
    const { extractImageMetadata, parseImage } = await import("@/lib/nai/media");
    const metadata = await extractImageMetadata(file);
    if (metadata.type !== "NOVELAI" || !metadata.entries.length) {
      const parsed = await parseImage(file);
      const { generationSize } = await import("@/lib/nai/models");
      const dataUrl = `data:image/png;base64,${parsed.base64}`;
      const store = useStore.getState();
      const imageSource = { dataUrl, width: parsed.width, height: parsed.height, mode: "img2img" as const, strength: 0.7, noise: 0, inpaintStrength: 1 };
      store.patchSettings({ ...generationSize(parsed.width, parsed.height), imageSource });
      const settings = structuredClone(useStore.getState().settings);
      const imported = { dataUrl, settings: { ...settings, width: parsed.width, height: parsed.height }, filename: file.name, seed: -1,
        timestamp: new Date().toISOString(), batchId: Date.now(), batchIndex: 0, batchSize: 1 };
      useStore.setState({ selectedImage: imported, selectedBatch: [imported], enhancement: null, lastError: null });
      setUI({ activeTab: "basic", settingsCollapsed: false, focusedIndex: null });
      toast.success(translateUI("Imported {0} as a base image. Your prompt and settings were kept.", file.name), { id: TOAST_ID });
      return true;
    }
    const { importNovelAIRecipe } = await import("@/lib/nai/import-recipe");
    const recipe = await importNovelAIRecipe(file);

    restoreSettings(recipe.settings, {
      message: translateUI("Imported {0} recipe fields from {1}", recipe.importedFields.length, file.name),
      toastId: TOAST_ID,
    });
    // Reveal the composer — the recipe just rewrote it, and on compact layouts (or with the rail
    // collapsed via `[`) the destination is off screen, so the import looks like it did nothing.
    setUI({ activeTab: "basic", settingsCollapsed: false });

    if (recipe.omittedReferences) {
      toast.warning(
        translateUI("Reference strengths were found, but source reference images are not embedded in NovelAI PNGs."),
      );
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : translateUI("The image could not be read.");
    toast.error(message, { id: TOAST_ID });
    return false;
  }
}

/**
 * Opens a native file picker and imports the chosen image. This is the keyboard-reachable path to
 * the same feature — drag-and-drop alone would make recipe import unusable without a pointer.
 */
export function pickRecipeFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    void importRecipeFile(input.files?.[0]);
  });
  input.click();
}
