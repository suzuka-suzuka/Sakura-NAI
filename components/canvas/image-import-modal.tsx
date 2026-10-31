"use client";

import { ImagePlus, Palette, UserRound } from "lucide-react";
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
  const choices: { purpose: ImageImportPurpose; title: string; icon: typeof Palette; disabled?: boolean }[] = [
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
      <details open={!image.recipe} className="text-xs">
      <summary className="mb-2 cursor-pointer py-2 text-muted">{t("Other image uses")}</summary>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map(({ purpose, title, icon: Icon, disabled }) => <button
          key={purpose} type="button" disabled={busy || disabled}
          onClick={() => applyImageImport(purpose, options)}
          className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border-soft bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="text-sm font-semibold text-fg">{title}</span>
        </button>)}
      </div>
      </details>
      <Button variant="ghost" className="mt-4 w-full" onClick={close}>{t("Cancel")}</Button>
    </>;
}

function ParameterImport({ busy, recipe, options, setOptions }: {
  busy: boolean; recipe: ImportedRecipe; options: RecipeImportOptions;
  setOptions: React.Dispatch<React.SetStateAction<RecipeImportOptions>>;
}) {
  const current = useStore(state => state.settings);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const hasVibes = recipe.settings.vibe.length > 0;
  const hasSeed = recipe.importedFields.includes("seed");
  const hasSelection = options.prompt || options.negativePrompt || options.characters || options.settings || options.seed || options.vibes && hasVibes;
  let vibeModel = "";
  let vibeError = "";
  if (options.vibes && hasVibes) {
    try { vibeModel = compatibleVibeModel([...(options.appendVibes ? current.vibe : []), ...recipe.settings.vibe], options.settings ? recipe.settings.model : current.model); }
    catch (error) { vibeError = error instanceof Error ? error.message : "These Vibes have no compatible model. Import their original reference images separately."; }
  }
  const warning = recipeReproductionMessage(recipe);
  const checkbox = (key: keyof RecipeImportOptions, label: string, disabled = false) => <label className={`flex min-h-9 items-center gap-2 text-sm ${disabled ? "text-muted" : "text-fg"}`}>
    <input type="checkbox" checked={key === "vibes" && !hasVibes ? false : options[key] ?? false} disabled={busy || disabled} className="size-4 shrink-0 accent-accent"
      onChange={event => {
        if (key === "seed" && event.target.checked) { setConfirmSeed(true); return; }
        setOptions(previous => ({ ...previous, [key]: event.target.checked }));
      }} />{t(label)}
  </label>;
  const preview: [string, string | number][] = [];
  const add = (field: string, label: string, value: string | number) => { if (recipe.importedFields.includes(field)) preview.push([label, value]); };
  add("model", "Model", modelLabel(recipe.settings.model));
  add("resolution", "Resolution", `${recipe.settings.width} × ${recipe.settings.height}`);
  add("steps", "Steps", recipe.settings.steps);
  add("sampler", "Sampler", recipe.settings.sampler);
  add("noise schedule", "Noise schedule", recipe.settings.noiseSchedule);
  add("guidance", "Prompt guidance", recipe.settings.scale);
  add("guidance rescale", "CFG Rescale", recipe.settings.cfgRescale);
  add("Variety+", "Variety+", recipe.settings.varietyPlus ? "ON" : "OFF");
  add("seed", "Seed", recipe.settings.seed);
  add("batch size", "Images per generation", recipe.settings.nSamples);
  if (hasVibes) preview.push(["Vibe strengths", recipe.settings.vibe.map(ref => ref.strength).join(", ")]);
  if (recipe.settings.characters.length) preview.push(["Character positions", recipe.settings.useCoords ? "ON" : "OFF"]);
  return <div className="mb-4 space-y-3 rounded-[var(--radius-card)] border border-border-soft p-3">
    <div className="sticky top-0 z-10 bg-surface py-2"><Button className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={busy || !hasSelection || confirmSeed || !!vibeError} onClick={() => applyImageImport("recipe", options)}>{t("Import metadata")}</Button></div>
    <div>
      <p className="text-sm font-semibold text-accent">{t("Generation parameters found")}</p>
      <p className="mt-1 text-xs text-muted">{t("Choose which prompts and settings to import.")}</p>
    </div>
    <Button variant="outline" size="sm" className="h-auto min-h-9 whitespace-normal py-2 text-left" disabled={busy} onClick={() => {
      setOptions({ ...DEFAULT_RECIPE_IMPORT }); setConfirmSeed(false);
    }}>{t("Select all parameters (excluding seed, including Vibes)")}</Button>
    <p className="text-xs leading-relaxed text-muted">{t("Select all uses a random seed, replaces characters and Vibes, and turns off tag cleanup. Imported characters keep their position settings.")}</p>
    {warning && <p role="note" className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">{t(warning)}</p>}
    {recipe.omittedReferences && <p className="text-xs leading-relaxed text-muted">{t("Parameters can be imported. To reuse the original reference images, upload those files separately.")}</p>}
    {vibeModel && vibeModel !== current.model && <p className="text-xs text-muted">{t("Importing these Vibes will switch to {0}.", modelLabel(vibeModel, true))}</p>}
    {recipe.imageSettings && <p className="text-xs text-muted">{t("Saved image settings: strength {0}, noise {1}", recipe.imageSettings.mode === "infill" ? recipe.imageSettings.inpaintStrength : recipe.imageSettings.strength, recipe.imageSettings.noise)}</p>}
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded bg-bg p-3 text-xs">
      {preview.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted">{t(label)}</dt><dd className="break-words text-fg-2">{value}</dd></div>)}
    </dl>
    <details className="text-xs">
      <summary className="cursor-pointer py-1 text-fg-2">{t("Preview prompts and characters")}</summary>
      <dl className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded bg-bg p-2">
        {recipe.importedFields.includes("prompt") && <div><dt className="text-muted">{t("Prompt")}</dt><dd className="whitespace-pre-wrap break-words">{recipe.settings.prompt || t("Empty")}</dd></div>}
        {recipe.importedFields.includes("undesired content") && <div><dt className="text-muted">{t("Undesired content")}</dt><dd className="whitespace-pre-wrap break-words">{recipe.settings.negativePrompt || t("Empty")}</dd></div>}
        {recipe.settings.characters.map((character, index) => <div key={index}><dt className="text-muted">{t("Characters")} {index + 1} · ({character.center.x}, {character.center.y})</dt><dd className="whitespace-pre-wrap break-words">{character.prompt}</dd><dd className="whitespace-pre-wrap break-words text-muted">{t("Undesired content")}: {character.uc || t("Empty")}</dd></div>)}
      </dl>
    </details>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="space-y-1">
        {checkbox("prompt", "Positive prompt (Prompt)")}
        {checkbox("negativePrompt", "Negative prompt (Undesired Content)")}
        {checkbox("characters", "Character prompts (Characters)")}
        <div className="pl-6">{checkbox("appendCharacters", "Append characters", !options.characters)}</div>
        {checkbox("vibes", "Embedded Vibes (Vibe Transfer)", !hasVibes)}
        <div className="space-y-1 pl-6">
          <p className="text-xs leading-relaxed text-muted">{t(hasVibes
            ? "Embedded Vibes reuse their saved encodings with a compatible model, without another encoding charge. They contain no original reference images; a new encoding requires the originals."
            : "No embedded Vibe encodings were found in this image.")}</p>
          {checkbox("appendVibes", "Append Vibes", !options.vibes || !hasVibes)}
        </div>
        {checkbox("settings", "Generation settings (Settings)")}
        <div className="space-y-1 pl-6">
          {checkbox("seed", "Import seed", !hasSeed || confirmSeed)}
          <p className="text-xs leading-relaxed text-muted">{t(hasSeed ? "A random seed is used by default. Importing the image seed requires confirmation." : "This image has no saved seed. A random seed will be used.")}</p>
          {confirmSeed && <div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-xs">
            <p>{t("Import seed {0}? It will stay fixed for subsequent generations. The same seed alone does not guarantee the same image.", recipe.settings.seed)}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => { setOptions(previous => ({ ...previous, seed: true })); setConfirmSeed(false); }}>{t("Use image seed")}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmSeed(false)}>{t("Keep random seed")}</Button>
            </div>
          </div>}
        </div>
      </div>
      <div className="space-y-2">
        {checkbox("cleanTags", "Clean imported tags")}
        <details className="text-xs leading-relaxed text-muted">
          <summary className="cursor-pointer py-1">{t("What does tag cleanup change?")}</summary>
          <p className="mt-1">{t("Trim outer whitespace and empty comma-separated entries in selected prompts and imported characters only. Keep weights, grouped text, tag order and repeated tags. Other settings are not reset.")}</p>
        </details>
      </div>
    </div>
    {vibeError && <p role="alert" className="text-xs text-danger">{t(vibeError)}</p>}
  </div>;
}
