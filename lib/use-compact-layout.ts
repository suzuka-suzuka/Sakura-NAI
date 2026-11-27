"use client";

import { useSyncExternalStore } from "react";

const COMPACT_QUERY = "(max-width: 1023px)";

export function isCompactLayout() {
  return typeof window !== "undefined" && !!window.matchMedia?.(COMPACT_QUERY).matches;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCompactLayout() {
  return useSyncExternalStore(subscribe, isCompactLayout, () => false);
}
