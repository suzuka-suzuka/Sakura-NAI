"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Indeterminate: no percentage or duration is implied by the moving line. */
export function GenerationWait({ className }: { className?: string }) {
  useLocale();
  return <div role="progressbar" aria-label={translateUI("Generation in progress")} data-testid="generation-wait"
    className={cn("flex h-12 w-full items-center px-3 text-accent", className)}>
    <div className="relative h-[3px] w-full overflow-hidden rounded-full">
      <span className="absolute inset-0 rounded-full bg-current opacity-15" />
      <span className="generation-sweep motion-keep absolute inset-y-0 left-0 w-[30%] rounded-full bg-current" />
    </div>
  </div>;
}
