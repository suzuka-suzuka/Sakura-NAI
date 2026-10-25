"use client";

import { toast } from "sonner";
import { translateUI as t } from "./i18n";
import { useStore } from "./store";
import { createStylePreset, parseStylePresets, type StylePreset } from "./style-presets";
import { parseVibeFile, isVibeFile } from "./nai/vibes";
import { beginFileImport, isLatestFileImport, FILE_IMPORT_TOAST_ID } from "./file-import-request";

export type StyleImportCandidate = { presets: StylePreset[]; filename: string };
export const STYLE_FILE_ACCEPT = ".naiv4vibe,.naiv4vibebundle,.json,.txt";
export const isStyleFile = (name: string) => isVibeFile(name) || /\.(json|txt)$/i.test(name);
export async function prepareStyleImport(files: File[]): Promise<boolean> {
  const state = useStore.getState();
  if (state.isGenerating || state.isPreparing || state.isDirectorProcessing || state.imageEditor || state.pendingPayment || state.showConnect || state.showDirector) return false;
  const request = beginFileImport();
  toast.dismiss(FILE_IMPORT_TOAST_ID);
  try {
    if (!files.length || files.length > 32) throw new Error("Choose between 1 and 32 files.");
    if (files.some(file => file.size > 64 * 1024 * 1024) || files.reduce((n, file) => n + file.size, 0) > 128 * 1024 * 1024) throw new Error("The selected style files are too large.");
    const presets: StylePreset[] = [];
    for (const file of files) {
      const text = await file.text();
      if (isVibeFile(file.name)) {
        const vibes = parseVibeFile(text, file.name);
        presets.push(createStylePreset(file.name.replace(/\.naiv4vibe(?:bundle)?$/i, ""), "vibe", { ...useStore.getState().settings, vibe: vibes }));
      } else if (/\.(json|txt)$/i.test(file.name)) presets.push(...parseStylePresets(text, file.name));
      else throw new Error("Choose a Vibe file, Sakura preset JSON, or plain text prompt.");
    }
    if (!isLatestFileImport(request)) return false;
    const current = useStore.getState();
    if (current.isGenerating || current.isPreparing || current.isDirectorProcessing || current.imageEditor || current.pendingPayment || current.showConnect || current.showDirector) return false;
    current.setUI({ showStyleLibrary: true, styleImport: { presets, filename: files.map(file => file.name).join(", ") }, imageImport: null });
    return true;
  } catch (error) {
    if (!isLatestFileImport(request)) return false;
    toast.error(t(error instanceof Error && error.name !== "ZodError" ? error.message : "This preset contains invalid or unsupported values."));
    return false;
  }
}

export function downloadStyleFile(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
