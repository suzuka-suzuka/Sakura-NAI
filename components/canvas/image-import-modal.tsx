"use client";

import { FileSliders, ImagePlus, Palette, UserRound } from "lucide-react";
import { useState } from "react";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { applyImageImport, pickOriginalRecipeFile, DEFAULT_RECIPE_IMPORT, type ImageImportPurpose, type RecipeImportOptions, type ImageImportCandidate } from "@/lib/recipe-import";
import type { ImportedRecipe } from "@/lib/nai/import-recipe";
import { recipeReproductionMessage } from "@/lib/nai/import-recipe";
import { modelLabel } from "@/lib/nai/models";
import { compatibleVibeModel } from "@/lib/nai/vibes";
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
  const hasSelection = [options.prompt, options.negativePrompt, options.characters, options.settings, options.seed, options.vibes && image.recipe?.settings.vibe.length].some(Boolean);
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
        <div className="mb-4 space-y-2 text-xs leading-relaxed text-muted">
          <p>{t(image.metadataError ? "The image is readable, but its generation metadata could not be read." : "This image has no generation metadata. You can still use it as a base or reference image.")}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={pickOriginalRecipeFile}>{t("Choose original file")}</Button>
        </div>}
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
  const current = useStore(state => state.settings);
  let vibeModel = "";
  if (options.vibes && recipe.settings.vibe.length) {
    try { vibeModel = compatibleVibeModel([...(options.append && !options.clean ? current.vibe : []), ...recipe.settings.vibe], options.settings ? recipe.settings.model : current.model); }
    catch { /* The apply action reports incompatible combinations without changing the draft. */ }
  }
  const warning = recipeReproductionMessage(recipe);
  const fields: { key: keyof RecipeImportOptions; label: string }[] = [
    { key: "prompt", label: "Prompt" }, { key: "negativePrompt", label: "Undesired content" },
    { key: "characters", label: "Characters" }, { key: "settings", label: "Settings" }, { key: "seed", label: "Seed" },
    ...(recipe.settings.vibe.length ? [{ key: "vibes" as const, label: "Embedded Vibes" }] : []),
    { key: "append", label: recipe.settings.vibe.length ? "Append prompts, characters and Vibes" : "Append prompts and characters" }, { key: "clean", label: "Start from default settings" },
  ];
  return <div className="mb-4 space-y-3 rounded-[var(--radius-card)] border border-border-soft p-3">
    <p className="text-xs font-semibold text-accent">{t("Generation parameters found")}</p>
    {warning && <p role="note" className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">{t(warning)}</p>}
    {recipe.omittedReferences && <p className="text-xs leading-relaxed text-muted">{t("Parameters can be imported. To reuse the original reference images, upload those files separately.")}</p>}
    {recipe.settings.vibe.length > 0 && <p className="text-xs leading-relaxed text-accent">{t("Found {0} embedded Vibe(s). Their saved encodings can be reused without an encoding charge.", recipe.settings.vibe.length)}</p>}
    {vibeModel && vibeModel !== current.model && <p className="text-xs text-muted">{t("Importing these Vibes will switch to {0}.", modelLabel(vibeModel, true))}</p>}
    {recipe.imageSettings && <p className="text-xs text-muted">{t("Saved image settings: strength {0}, noise {1}", recipe.imageSettings.mode === "infill" ? recipe.imageSettings.inpaintStrength : recipe.imageSettings.strength, recipe.imageSettings.noise)}</p>}
    <details className="text-xs">
      <summary className="cursor-pointer py-1 text-fg-2">{t("Preview parameters")}</summary>
      <dl className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded bg-bg p-2">
        {recipe.importedFields.includes("model") && <div><dt className="inline text-muted">{t("Model")}: </dt><dd className="inline">{modelLabel(recipe.settings.model)}</dd></div>}
        {recipe.importedFields.includes("prompt") && <div><dt className="text-muted">{t("Prompt")}</dt><dd className="whitespace-pre-wrap break-words">{recipe.settings.prompt || t("Empty")}</dd></div>}
        {recipe.importedFields.includes("undesired content") && <div><dt className="text-muted">{t("Undesired content")}</dt><dd className="whitespace-pre-wrap break-words">{recipe.settings.negativePrompt || t("Empty")}</dd></div>}
        {recipe.settings.characters.map((character, index) => <div key={index}><dt className="text-muted">{t("Characters")} {index + 1}</dt><dd className="whitespace-pre-wrap break-words">{character.prompt}</dd></div>)}
        {recipe.importedFields.includes("seed") && <div><dt className="inline text-muted">{t("Seed")}: </dt><dd className="inline">{recipe.settings.seed}</dd></div>}
        {recipe.importedFields.includes("steps") && <div><dt className="inline text-muted">{t("Steps")}: </dt><dd className="inline">{recipe.settings.steps}</dd></div>}
      </dl>
    </details>
    <p className="text-xs text-muted">{t("Choose metadata to import")}</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {fields.map(({ key, label }) => <label key={key} className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={options[key] ?? false} disabled={busy} className="accent-accent" onChange={event => setOptions(previous => ({ ...previous, [key]: event.target.checked }))} />{t(label)}
      </label>)}
    </div>
  </div>;
}
