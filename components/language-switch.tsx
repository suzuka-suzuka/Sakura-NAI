"use client";

import { Languages } from "lucide-react";
import { setLocale, useLocale } from "@/lib/i18n";

export function LanguageSwitch() {
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}
      aria-label={locale === "en" ? "切换为中文" : "Switch to English"}
      title={locale === "en" ? "切换为中文" : "Switch to English"}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 text-xs font-medium text-fg-2 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Languages className="size-4" />
      <span>{locale === "en" ? "中文" : "EN"}</span>
    </button>
  );
}
