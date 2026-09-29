"use client";

import { useSyncExternalStore } from "react";
import messages from "./zh-CN.json";

export type Locale = "en" | "zh-CN";
const STORAGE_KEY = "nya-locale";
let locale: Locale = "en";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => locale, () => "en");
}

export function setLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Session-only when storage is unavailable. */ }
  listeners.forEach((listener) => listener());
}

export function initLocale() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Use browser preference. */ }
  setLocale(saved === "en" || saved === "zh-CN" ? saved : navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
}

/** Translate UI copy only. Prompts, API values, model identifiers and user data stay untouched. */
export function translateUI(text: string, ...values: (string | number)[]): string {
  const translated = locale === "zh-CN"
    ? (messages as Record<string, string>)[text] ?? (messages as Record<string, string>)[text.trim()]
    : undefined;
  const template = translated === undefined ? text : text in messages ? translated : text.replace(text.trim(), translated);
  return template.replace(/\{(\d+)\}/g, (match, index) => values[Number(index)] === undefined ? match : String(values[Number(index)]));
}
