"use client";

import { useSyncExternalStore } from "react";

const COMPACT_QUERY = "(max-width: 1023px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCompactLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COMPACT_QUERY).matches, () => false);
}
