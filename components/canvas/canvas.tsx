"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, AlertTriangle, KeyRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { fade, listContainer, listItem, spring, usePrefersReducedMotion } from "@/lib/motion";
import { Button } from "@/components/ui/button";

import { BrandLogo } from "@/components/brand-logo";
import { focusRing } from "@/components/ui/input";


import { pickRecipeFile } from "@/lib/recipe-import";
import { StreamingGrid } from "./streaming-grid";
import { cn } from "@/lib/utils";
import { OfficialImageView } from "./official-image-view";

const EXAMPLES = [
  { title: "Girl among blossoms", prompt: "1girl, solo, cherry blossoms, falling petals, pink hair, white dress, gentle smile, spring, soft sunlight, dappled sunlight, depth of field" },
  { title: "Sakura Miko", prompt: "sakura miko, hololive, 1girl, solo, cherry blossoms, falling petals, smile, looking at viewer, spring, soft sunlight" },
  { title: "Moonlit blossoms", prompt: "1girl, solo, cherry blossoms, night, full moon, pink kimono, long hair, looking back, lantern, falling petals, moonlight, tranquil atmosphere" },
];

function AmbientField() {
  useLocale();
  const reduced = usePrefersReducedMotion();

  // Two counter-drifting accent blooms. Static gradients read as a flat backdrop; slow parallax
  // makes the stage feel like a live surface waiting for output rather than a dead panel. Frozen
  // (not removed) under reduced motion — the depth survives, the drift doesn't.
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute left-1/2 top-1/2 h-[520px] w-[520px] rounded-full blur-[110px]"
        style={{ background: "#ed9fbe", opacity: 0.16 }}
        initial={{ x: "-50%", y: "-50%" }}
        animate={reduced ? { x: "-50%", y: "-50%" } : { x: ["-58%", "-42%", "-58%"], y: ["-56%", "-44%", "-56%"] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 h-[380px] w-[380px] rounded-full blur-[100px]"
        style={{ background: "#c8a3ce", opacity: 0.08 }}
        initial={{ x: "-50%", y: "-50%" }}
        animate={reduced ? { x: "-50%", y: "-50%" } : { x: ["-38%", "-60%", "-38%"], y: ["-40%", "-58%", "-40%"] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function EmptyState() {
  useLocale();
  const patch = useStore((s) => s.patchSettings);
  const setUI = useStore((s) => s.setUI);
  // Examples are alternatives: choosing another one replaces only the main positive prompt.
  const applyExample = (ex: string) => {
    patch({ prompt: ex });
    setUI({ settingsCollapsed: false, activeTab: "basic", negativePromptActive: false });
    requestAnimationFrame(() => {
      const el = document.getElementById("prompt") as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <motion.div
      className="relative flex h-full flex-col items-center gap-5 overflow-y-auto px-5 py-8 text-center sm:px-8"
      variants={listContainer}
      initial="hidden"
      animate="show"
    >
      <AmbientField />

      <motion.div variants={listItem} className="relative mt-auto pt-2">
        <div className="flex size-20 items-center justify-center rounded-[28px] border border-border-soft bg-surface/80 shadow-[var(--shadow-card)]">
          <BrandLogo variant="mark" className="size-14" />
        </div>
      </motion.div>

      <motion.div variants={listItem} className="relative">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.22em] text-accent">SAKURA NAI</p>
        <h2 className="font-[family-name:var(--font-display)] text-[24px] font-bold tracking-[-0.02em] text-fg">
          {translateUI("Let your ideas bloom")}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-muted">
          {translateUI("Describe your image and hit Generate. Your images appear here and are saved to your gallery.")}</p>
      </motion.div>

      <motion.div variants={listItem} className="relative grid w-full min-w-0 max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
        {EXAMPLES.map((example) => (
          <motion.button
            key={example.title}
            type="button"
            onClick={() => applyExample(example.prompt)}
            title={example.prompt}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            transition={spring.snap}
            className={cn(
              "group min-w-0 rounded-xl border border-border-soft bg-surface/80 px-3.5 py-3 text-left shadow-[var(--shadow-card)]",
              "transition-[color,border-color,background-color] duration-fast hover:border-accent/50 hover:bg-surface-3",
              focusRing,
            )}
          >
            <span className="block text-[12.5px] font-bold text-fg">{translateUI(example.title)}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted group-hover:text-fg-2">
              {example.prompt}
            </span>
          </motion.button>
        ))}
      </motion.div>

      <motion.p variants={listItem} className="relative -mt-2 text-xs text-muted">
        {translateUI("Choose an example to replace the entire positive prompt.")}
      </motion.p>

      {/* The import path used to live in a collapsed sidebar section. Now that it's a drop gesture,
          this line is what tells anyone it exists — and the button keeps it reachable without a
          pointer, which a drop target alone can never be. */}
      <motion.p variants={listItem} className="relative text-[12px] text-muted">
        {translateUI(" Have a NovelAI PNG?")}{" "}
        <button
          type="button"
          onClick={pickRecipeFile}
          className={cn(
            "rounded-[4px] font-semibold text-fg-2 underline decoration-dotted underline-offset-2 transition-colors duration-instant hover:text-accent",
            focusRing,
          )}
        >
          {translateUI(" Import its recipe ")}</button>{" "}
        {translateUI(" or drop it anywhere. ")}</motion.p>

      <motion.p variants={listItem} className="relative mb-auto pb-2 text-[11.5px] leading-7 text-muted">
        {translateUI(" Press")}{" "}
        <kbd className="rounded-[5px] border border-border-soft bg-surface-2 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10.5px]">
          Ctrl + K
        </kbd>{" "}
        {translateUI(" for commands ·")}{" "}
        <kbd className="rounded-[5px] border border-border-soft bg-surface-2 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10.5px]">
          Ctrl + Enter
        </kbd>{" "}
        {translateUI(" to generate ")}</motion.p>
    </motion.div>
  );
}

/**
 * Maps an opaque API failure onto something the user can act on. Status codes are forwarded
 * verbatim whether the host is NovelAI directly or a proxy, so the copy stays neutral about which
 * credential was rejected and which side ran out of capacity.
 */
function explain(message: string): { title: string; detail: string; reconnect: boolean } {
  const m = message.toLowerCase();
  if (/401|403|unauthor|forbidden|token/.test(m))
    return {
      title: translateUI("Your credentials were rejected"),
      detail: translateUI("The key may have expired, been copied incompletely, or lost access. Re-enter it to try again."),
      reconnect: true,
    };
  if (/402|429|quota|rate limit|too many/.test(m))
    return {
      title: translateUI("Out of capacity"),
      detail: translateUI("The account is out of credit or too many requests are in flight. Wait a moment and retry."),
      reconnect: false,
    };
  if (/5\d\d|network|fetch|timeout|econn/.test(m))
    return {
      title: translateUI("Couldn't reach the server"),
      detail: translateUI("The host didn't respond. Check your connection, or the Host URL under Connect."),
      reconnect: true,
    };
  return { title: translateUI("Generation failed"), detail: translateUI("The request didn't complete. Your settings are untouched."), reconnect: false };
}

function ErrorState({ message }: { message: string }) {
  useLocale();
  const generate = useStore((s) => s.generate);
  const setUI = useStore((s) => s.setUI);
  const clearError = useStore((s) => s.clearError);
  const failedSettings = useStore(s => s.lastError?.settings);
  const { title, detail, reconnect } = explain(message);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border-soft bg-surface-2 shadow-[var(--shadow-card)]">
        <AlertTriangle className="size-6 text-danger" />
      </div>
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[22px] font-bold tracking-[-0.02em] text-fg">{title}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-muted">{detail}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => void generate(undefined, failedSettings)}>
          <RotateCcw className="size-4" /> {translateUI(" Try again ")}</Button>
        {reconnect && (
          <Button variant="secondary" onClick={() => setUI({ showConnect: true })}>
            <KeyRound className="size-4" /> {translateUI(" Reconnect ")}</Button>
        )}
        <Button variant="ghost" onClick={clearError}>{translateUI("Dismiss")}</Button>
      </div>
      <details className="max-w-md text-left">
        <summary className={cn("cursor-pointer list-none text-[12px] text-muted hover:text-fg-2", focusRing)}>{translateUI("Details")}</summary>
        <pre className="mt-2 overflow-x-auto rounded-[var(--radius-chip)] bg-surface-2 p-3 font-[family-name:var(--font-mono)] text-[11.5px] text-fg-2">
          {message}
        </pre>
      </details>
    </div>
  );
}

export function Canvas() {
  useLocale();
  const streaming = useStore((s) => s.streamingBatch);
  const batch = useStore((s) => s.selectedBatch);
  const selected = useStore((s) => s.selectedImage);
  const lastError = useStore((s) => s.lastError);
  const generating = useStore(s => s.isGenerating);
  const preview = useStore(s => s.runPreview);

  // Streaming keeps the previous image as its backdrop, so committing never blanks the stage.
  if (generating && !preview) return batch?.length ? <OfficialImageView batch={batch} selected={selected} /> : <div data-testid="blank-canvas" className="h-full w-full bg-bg" aria-label={translateUI("Blank canvas")} />;
  if (streaming) return <StreamingGrid tiles={streaming} backdrop={(selected ?? batch?.[0])?.dataUrl ?? null} />;
  if (lastError) return <ErrorState message={lastError.message} />;
  if (batch && batch.length) return <OfficialImageView batch={batch} selected={selected} />;
  return <EmptyState />;
}
