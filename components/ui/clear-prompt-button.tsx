"use client";

import { Eraser } from "lucide-react";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { IconButton } from "./icon-button";

export function ClearPromptButton({ label, value, onClear }: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  useLocale();
  return <IconButton
    label={t("Clear {0}", label)}
    size="sm"
    className="absolute right-2 top-2 size-6 text-muted hover:text-fg"
    disabled={value.length === 0}
    onMouseDown={event => event.preventDefault()}
    onClick={onClear}
  ><Eraser /></IconButton>;
}
