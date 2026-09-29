"use client";
import { useEffect, useState } from "react";

/** Fit a pixel canvas inside both available dimensions without changing its aspect ratio. */
export function useFitCanvas(width: number, height: number) {
  const [node, container] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(entry.contentRect.width / width, entry.contentRect.height / height);
      setSize({ width: Math.max(0, width * scale), height: Math.max(0, height * scale) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, width, height]);
  return { container, size };
}
