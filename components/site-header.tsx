"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { GenerationCost } from "./generation-cost";
import { GenerationWait } from "./generation-wait";
import { LanguageSwitch } from "./language-switch";
import { Images, PanelLeftOpen, Search, Sparkles, Square } from "lucide-react";
import { useStore } from "@/lib/store";
import { BrandLogo } from "./brand-logo";
import { ThemeControls } from "./theme-controls";
import { IconButton } from "./ui/icon-button";
import { focusRing } from "./ui/input";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  useLocale();
  const status = useStore((s) => s.connectionStatus);
  const connectionError = useStore((s) => s.connectionError);
  const isPreparing = useStore(s => s.isPreparing);
  const isGenerating = useStore((s) => s.isGenerating);
  const imageCount = useStore((s) => s.images.length);
  const generate = useStore((s) => s.generate);
  const cancelGenerate = useStore((s) => s.cancelGenerate);
  const abortRequested = useStore((s) => s.abortRequested);
  const canCancelGeneration = useStore((s) => s.canCancelGeneration);
  const setUI = useStore((s) => s.setUI);
  const connected = status === "ok";

  const connectionLabel =
    status === "verifying" ? translateUI("Checking") : status === "invalid" ? translateUI("Reconnect") : status === "unknown" ? translateUI("Unverified") : connected ? translateUI("Connected") : translateUI("Connect");

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border-soft bg-surface/95 px-2.5 shadow-[0_1px_0_0_var(--border-soft)] backdrop-blur-xl sm:px-4">
      <IconButton
        label={translateUI("Open settings")}
        title={translateUI("Open settings")}
        onClick={() => setUI({ settingsCollapsed: false, galleryOpen: false })}
        className="xl:hidden"
      >
        <PanelLeftOpen />
      </IconButton>

      <div className="flex min-w-0 items-center gap-2.5">
        <BrandLogo variant="mark" priority className="size-7 sm:hidden" />
        <BrandLogo priority className="hidden h-8 w-[120px] sm:inline-flex" />
        <span className="mt-0.5 hidden text-[11px] text-muted lg:inline">{translateUI("Your personal image studio")}</span>
      </div>

      {/* A hidden Ctrl+K is a shortcut only the people who already knew about it will find. This is the
          discoverable surface for it; on narrow screens it degrades to the icon alone. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("nya-command-palette"))}
        aria-label={translateUI("Open command palette")}
        aria-keyshortcuts="Meta+K Control+K"
        title={translateUI("Search commands — Ctrl + K")}
        className={cn(
          "group ml-3 flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border border-border-soft bg-surface-2 px-2.5 text-muted",
          "transition-[background-color,color,border-color] duration-instant hover:border-border hover:bg-surface-3 hover:text-fg-2 md:w-56 md:px-3",
          focusRing,
          "focus-visible:ring-offset-surface",
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left text-[12.5px] md:inline">{translateUI("Search or jump to…")}</span>
        <kbd className="hidden shrink-0 rounded-[5px] border border-border-soft bg-surface px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-muted md:block">
          Ctrl + K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        <button
          type="button"
          onClick={() => isGenerating ? cancelGenerate() : void generate()}
          disabled={isPreparing || abortRequested || (isGenerating && !canCancelGeneration)}
          aria-label={isGenerating ? (canCancelGeneration ? translateUI("Stop generation") : translateUI("Generation in progress")) : translateUI("Generate")}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          title={isGenerating
            ? canCancelGeneration
              ? translateUI("Stop — finished images are kept")
              : translateUI("Generation in progress")
            : translateUI("Generate — Ctrl + Enter")}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] bg-accent px-2.5 text-[12.5px] font-bold text-on-accent shadow-[var(--glow-accent)]",
            "transition-[filter,transform] duration-fast ease-out hover:brightness-[1.07] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-70 xl:hidden",
            focusRing,
            "focus-visible:ring-offset-surface",
          )}
        >
          {isGenerating
            ? canCancelGeneration
              ? <Square className="size-3.5" />
              : <GenerationWait className="h-9 w-10 px-0 text-on-accent" />
            : <Sparkles className="size-4" />}
          {(!isGenerating || canCancelGeneration) && <span className="hidden sm:inline">
            {abortRequested ? translateUI("Stopping") : isGenerating ? (canCancelGeneration ? translateUI("Stop") : translateUI("Working")) : translateUI("Generate")}
          </span>}
          {!isGenerating && <GenerationCost />}
        </button>
        <button
          type="button"
          onClick={() => setUI({ showConnect: true })}
          aria-label={connectionLabel}
          title={connectionError ? translateUI(connectionError) : connectionLabel}
          className={cn(
            "flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border border-border-soft bg-surface-2 px-2.5 text-[12.5px] font-medium text-fg-2 transition-colors duration-instant hover:bg-surface-3 hover:text-fg sm:px-3",
            focusRing,
            "focus-visible:ring-offset-surface",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              status === "invalid" ? "bg-danger" : status === "verifying" ? "animate-pulse bg-warn" : connected ? "bg-ok" : "bg-warn",
            )}
            style={connected ? { boxShadow: "0 0 8px var(--ok)" } : undefined}
          />
          <span className="hidden sm:inline">{connectionLabel}</span>
        </button>
        <LanguageSwitch />
        <ThemeControls />
        <IconButton
          label={translateUI("Open gallery")}
          title={translateUI("Open gallery")}
          onClick={() => setUI({ galleryOpen: true, settingsCollapsed: true })}
          className="relative xl:hidden"
        >
          <Images />
          {imageCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-[family-name:var(--font-mono)] text-[9px] font-bold text-on-accent">
              {imageCount > 99 ? "99+" : imageCount}
            </span>
          )}
        </IconButton>
      </div>
    </header>
  );
}
