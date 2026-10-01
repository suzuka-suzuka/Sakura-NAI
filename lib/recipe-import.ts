"use client";

import { translateUI } from "@/lib/i18n";
import { toast } from "sonner";
import { useStore } from "./store";

/**
 * Import a NovelAI PNG recipe into the composer.
 *
 * Lifted out of the old sidebar-only RecipeImporter so the canvas drop zone, the command palette,
 * and the file picker all run the same path — including the same validation, the same toast ids,
 * and the same dynamic import boundary. Three copies of this would be three chances to diverge.
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
