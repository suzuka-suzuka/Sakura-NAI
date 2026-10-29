"use client";

import { useId } from "react";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { V5_FULL, V5_FULL_MEDIUM } from "@/lib/nai/models";

export function EffortToggle() {
  useLocale();
  const model = useStore(s => s.settings.model), patch = useStore(s => s.patchSettings);
  const name = useId();
  if (model !== V5_FULL && model !== V5_FULL_MEDIUM) return null;
  return <div className="flex items-center gap-2 text-xs">
    <span className="shrink-0">{t("Effort")}</span>
    <div role="radiogroup" aria-label={t("Effort")} className="flex min-w-0 flex-1 overflow-hidden rounded border border-border-soft bg-surface-2">
      {([
        [V5_FULL, "High"],
        [V5_FULL_MEDIUM, "Medium"],
      ] as const).map(([value, label]) => <label key={value} className="min-w-0 flex-1 cursor-pointer border-r border-border-soft last:border-r-0">
        <input type="radio" name={name} value={value} checked={model === value}
          onChange={() => patch({ model: value })} className="peer sr-only" />
        <span className="flex min-h-9 items-center justify-center whitespace-nowrap px-2 py-2 font-semibold text-muted transition-colors hover:text-fg peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-accent">
          {t(label)}
        </span>
      </label>)}
    </div>
  </div>;
}
