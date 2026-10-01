"use client";

import { translateUI, useLocale, initLocale } from "@/lib/i18n";
import { useEffect } from "react";
import { PanelLeftOpen, Images } from "lucide-react";
import { useStore } from "@/lib/store";
import { useCompactLayout } from "@/lib/use-compact-layout";
import { PaymentConfirmModal } from "./payment-confirm-modal";
import { CharacterPositions } from "./canvas/character-positions";
import { ImageEditor } from "./canvas/image-editor";
import { ConnectModal } from "./connect-modal";
import { SettingsSidebar } from "./sidebar/settings-sidebar";
import { Canvas } from "./canvas/canvas";
import { RecipeDropzone } from "./canvas/recipe-dropzone";
import { ImageImportModal } from "./canvas/image-import-modal";
import { Lightbox } from "./canvas/lightbox";
import { DirectorModal } from "./canvas/director-modal";
import { HistoryPanel } from "./gallery/history-panel";
import { CommandPalette } from "./command-palette";
import { IconButton } from "./ui/icon-button";
import { cn } from "@/lib/utils";
import type { ConnectionOptions } from "@/lib/connection-options";

export function Studio({ connectionOptions }: { connectionOptions: ConnectionOptions }) {
  useLocale();
  const init = useStore((s) => s.init);
  const compact = useCompactLayout();
  const settingsCollapsed = useStore((s) => s.settingsCollapsed);
  const collapsed = compact && settingsCollapsed;
  const galleryOpen = useStore((s) => s.galleryOpen);
  const imageCount = useStore((s) => s.images.length);
  const galleryStatus = useStore((s) => s.galleryStatus);
  const setUI = useStore((s) => s.setUI);
  const isGenerating = useStore((s) => s.isGenerating);
  const canCancelGeneration = useStore((s) => s.canCancelGeneration);
  const streaming = useStore((s) => s.streamingBatch);
  const showPositions = useStore(s => s.showPositions);

  useEffect(() => {
    initLocale();
    void init();
  }, [init]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const synchronize = () => {
      const state = useStore.getState();
      if (media.matches && !state.settingsCollapsed && state.galleryOpen) state.setUI({ galleryOpen: false });
    };
    synchronize();
    media.addEventListener("change", synchronize);
    return () => media.removeEventListener("change", synchronize);
  }, [collapsed, galleryOpen]);

  // Global accelerators. Cmd/Ctrl+Enter is the commit gesture from anywhere — without it the only
  // way to generate is a mouse round-trip to the sidebar button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.showConnect || s.showDirector || s.pendingPayment || s.isPreparing || s.focusedIndex !== null || s.imageEditor || s.imageImport) return;

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!s.isGenerating) void s.generate();
        return;
      }
      // Panel toggles — skip while typing, or they'd swallow the brackets.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const compact = window.matchMedia("(max-width: 1023px)").matches;
      if (e.key === "Escape" && compact && (!s.settingsCollapsed || s.galleryOpen)) {
        s.setUI({ settingsCollapsed: true, galleryOpen: false });
      }
      if (e.key === "[" && compact) {
        s.setUI({ settingsCollapsed: !s.settingsCollapsed, galleryOpen: false });
      }
      if (e.key === "]") {
        s.setUI({ galleryOpen: !s.galleryOpen, ...(compact ? { settingsCollapsed: true } : {}) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meanProgress = streaming?.length
    ? streaming.reduce((a, t) => a + t.progress, 0) / streaming.length
    : 0;

  return (
    <div className="nai-workspace flex h-dvh flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-soft bg-surface px-3 lg:hidden">
        <IconButton label={translateUI("Expand settings")} onClick={() => setUI({ settingsCollapsed: !collapsed, galleryOpen: false })}><PanelLeftOpen /></IconButton>
        <span className="font-bold text-accent">Sakura NAI</span>
        <IconButton label={translateUI("Open gallery")} onClick={() => setUI({ galleryOpen: !galleryOpen, settingsCollapsed: true })}><Images /></IconButton>
      </div>
      <main className="relative flex min-h-0 flex-1 isolate">
        {/* Compact layouts promote the canvas to the primary surface and turn both dense panels
            into drawers. One shared scrim keeps the relationship obvious and gives pointer users
            a generous close target. Wide screens retain the always-visible workstation. */}
        <button
          type="button"
          inert={collapsed && !galleryOpen}
          tabIndex={!collapsed || galleryOpen ? 0 : -1}
          aria-hidden={collapsed && !galleryOpen}
          aria-label={translateUI("Close open panel")}
          onClick={() => setUI({ settingsCollapsed: true, galleryOpen: false })}
          className={cn(
            "fixed inset-x-0 bottom-0 top-12 z-20 bg-black/45 backdrop-blur-[2px] transition-opacity duration-fast lg:hidden",
            !collapsed || galleryOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />

        {/* Settings stay visible on desktop; only compact screens use the drawer. */}
        <aside
          className={cn(
            "fixed bottom-0 left-0 top-12 z-30 w-[min(400px,calc(100vw-2rem))] shrink-0 overflow-hidden border-r border-border-soft bg-surface shadow-[var(--shadow-panel)]",
            "transition-transform duration-slow ease-standard lg:relative lg:inset-auto lg:z-10 lg:w-[400px] lg:translate-x-0 lg:shadow-[6px_0_30px_-20px_rgba(0,0,0,0.6)]",
            collapsed ? "-translate-x-full" : "translate-x-0",
          )}
        >
          <div
            inert={collapsed}
            className={cn(
              "h-full w-full transition-opacity duration-fast lg:w-[400px]",
              collapsed ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <SettingsSidebar />
          </div>
        </aside>

        <section className="relative z-0 min-w-0 flex-1 bg-bg" aria-busy={isGenerating}>
          {showPositions ? <CharacterPositions /> : <Canvas />}
          {/* Listens on window, draws here — a recipe PNG can be dropped anywhere in the studio,
              but the invitation appears over the stage. */}
          <RecipeDropzone />
        </section>

        <aside
          className={cn(
            "fixed bottom-0 right-0 top-12 z-30 w-[min(144px,calc(100vw-2rem))] shrink-0 overflow-hidden border-l border-border-soft bg-surface shadow-[var(--shadow-panel)]",
            "transition-transform duration-slow ease-standard lg:relative lg:inset-auto lg:z-10 lg:shadow-[-6px_0_30px_-20px_rgba(0,0,0,0.6)] lg:transition-[width]",
            galleryOpen ? "translate-x-0 lg:w-[144px]" : "translate-x-full lg:w-11 lg:translate-x-0",
          )}
        >
          <div
            inert={galleryOpen}
            className={cn(
              "absolute inset-y-0 left-0 hidden w-11 flex-col items-center py-3 transition-opacity duration-fast lg:flex",
              galleryOpen ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <IconButton
              label={translateUI("Open gallery")}
              title={translateUI("Open gallery — ]")}
              onClick={() => setUI({ galleryOpen: true })}
              size="sm"
              className="relative"
            >
              <Images />
              {galleryStatus === "ready" && imageCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-[family-name:var(--font-mono)] text-[10px] font-bold text-on-accent">
                  {imageCount > 99 ? "99+" : imageCount}
                </span>
              )}
            </IconButton>
          </div>

          <div
            inert={!galleryOpen}
            className={cn(
              "h-full w-full transition-opacity duration-fast lg:w-[144px]",
              galleryOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <HistoryPanel />
          </div>
        </aside>
      </main>

      {/* Progress is otherwise silent for screen-reader users for the whole run. */}
      <div role="status" aria-live="polite" aria-atomic className="sr-only">
        {isGenerating
          ? canCancelGeneration
            ? translateUI("Generating {0} images, {1} percent", streaming?.length ?? 0, Math.round(meanProgress * 100))
            : translateUI("Generating {0} final images", streaming?.length ?? 0)
          : ""}
      </div>

      <PaymentConfirmModal />
      <ConnectModal connectionOptions={connectionOptions} />
      <DirectorModal />
      <ImageEditor />
      <Lightbox />
      <CommandPalette />
      <ImageImportModal />
    </div>
  );
}
