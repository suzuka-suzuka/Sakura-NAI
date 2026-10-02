"use client";

import { FileSliders, ImagePlus, Palette, UserRound } from "lucide-react";
import { useState } from "react";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { applyImageImport, DEFAULT_RECIPE_IMPORT, type ImageImportPurpose, type RecipeImportOptions, type ImageImportCandidate } from "@/lib/recipe-import";
import type { ImportedRecipe } from "@/lib/nai/import-recipe";
import { recipeReproductionMessage } from "@/lib/nai/import-recipe";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export function ImageImportModal() {
  useLocale();
  const image = useStore(s => s.imageImport);
  const setUI = useStore(s => s.setUI);
  const busy = useStore(s => s.isGenerating || s.isPreparing || s.isDirectorProcessing || !!s.pendingPayment);
  const close = () => setUI({ imageImport: null });
  return <Modal open={!!image} onClose={close} title={t("Select image purpose")} className="max-w-xl">
    {image && <ImportContent key={image.preview} image={image} busy={busy} close={close} />}
  </Modal>;
}

function ImportContent({ image, busy, close }: { image: ImageImportCandidate; busy: boolean; close: () => void }) {
  const [options, setOptions] = useState({ ...DEFAULT_RECIPE_IMPORT });
  const hasSelection = [options.prompt, options.negativePrompt, options.characters, options.settings, options.seed].some(Boolean);
  const choices: { purpose: ImageImportPurpose; title: string; icon: typeof Palette; disabled?: boolean }[] = [
    { purpose: "recipe", title: t("Import image parameters"),
      icon: FileSliders, disabled: !image.recipe || !hasSelection },
    { purpose: "img2img", title: t("Use as Image2Image base"), icon: ImagePlus },
    { purpose: "vibe", title: t("Use for Vibe Transfer"), icon: Palette },
    { purpose: "directorReference", title: t("Use as character reference"), icon: UserRound },
  ];

  return <>
      <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-border-soft bg-surface-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.preview} alt={image.filename} className="size-20 shrink-0 rounded-lg object-contain" />
        <div className="min-w-0 text-sm">
          <p className="break-all font-semibold text-fg">{image.filename}</p>
          <p className="mt-1 text-xs text-muted">{image.width} × {image.height}</p>
        </div>
      </div>
      {image.recipe ? <ParameterImport busy={busy} recipe={image.recipe} options={options} setOptions={setOptions} /> :
        <p className="mb-4 text-xs text-muted">{t(image.metadataError ? "The image is readable, but its generation metadata could not be read." : "This image has no generation metadata. You can still use it as a base or reference image.")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map(({ purpose, title, icon: Icon, disabled }) => <button
          key={purpose} type="button" disabled={busy || disabled}
          onClick={() => applyImageImport(purpose, options)}
          className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border-soft bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="text-sm font-semibold text-fg">{title}</span>
        </button>)}
      </div>
      <Button variant="ghost" className="mt-4 w-full" onClick={close}>{t("Cancel")}</Button>
    </>;
}

function ParameterImport({ busy, recipe, options, setOptions }: {
  busy: boolean; recipe: ImportedRecipe; options: RecipeImportOptions;
  setOptions: React.Dispatch<React.SetStateAction<RecipeImportOptions>>;
}) {
  const warning = recipeReproductionMessage(recipe);
  const fields: { key: keyof RecipeImportOptions; label: string }[] = [
    { key: "prompt", label: "Prompt" }, { key: "negativePrompt", label: "Undesired content" },
    { key: "characters", label: "Characters" }, { key: "settings", label: "Settings" }, { key: "seed", label: "Seed" },
    { key: "append", label: "Append prompts and characters" }, { key: "clean", label: "Start from default settings" },
  ];
  return <div className="mb-4 space-y-3 rounded-[var(--radius-card)] border border-border-soft p-3">
    <p className="text-xs font-semibold">{t("Choose metadata to import")}</p>
    {warning && <p role="note" className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">{t(warning)}</p>}
    {recipe.omittedReferences && <p className="text-xs leading-relaxed text-muted">{t("Reference strengths were found, but source reference images are not embedded in NovelAI PNGs.")}</p>}
    {recipe.imageSettings && <p className="text-xs text-muted">{t("Saved image settings: strength {0}, noise {1}", recipe.imageSettings.mode === "infill" ? recipe.imageSettings.inpaintStrength : recipe.imageSettings.strength, recipe.imageSettings.noise)}</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {fields.map(({ key, label }) => <label key={key} className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={options[key]} disabled={busy} className="accent-accent" onChange={event => setOptions(previous => ({ ...previous, [key]: event.target.checked }))} />{t(label)}
      </label>)}
    </div>
  </div>;
}
