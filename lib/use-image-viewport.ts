"use client";
import { useCallback, useEffect, useState } from "react";
import { zoomAt, type Point } from "./editor-geometry";

export function useImageViewport(width: number, height: number) {
  const [node, container] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(0);
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [drag, setDrag] = useState<(Point & { pan: Point }) | null>(null);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([e]) => setFit(Math.max(0, Math.min((e.contentRect.width - 48) / width, (e.contentRect.height - 48) / height))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, width, height]);
  const changeZoom = useCallback((value: number, pointer: Point = { x: 0, y: 0 }, relative = false) => {
    setView(old => {
      const zoom = Math.max(0.1, Math.min(16, relative ? old.zoom * value : value));
      return { zoom, pan: zoomAt(old.pan, pointer, zoom / old.zoom) };
    });
  }, []);
  useEffect(() => {
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (drag) return;
      const r = node.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      changeZoom(Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }, true);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [node, changeZoom, drag]);
  const startPan = (e: React.PointerEvent) => { setDrag({ x: e.clientX, y: e.clientY, pan: { ...view.pan } }); e.currentTarget.setPointerCapture(e.pointerId); };
  const movePan = (e: React.PointerEvent) => {
    if (!drag) return false;
    const d = drag;
    setView(v => ({ ...v, pan: { x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y } }));
    return true;
  };
  const endPan = () => setDrag(null);
  const reset = () => setView({ zoom: 1, pan: { x: 0, y: 0 } });
  return { container, zoom: view.zoom, fit, scale: fit * view.zoom, pan: view.pan, panning: !!drag, startPan, movePan, endPan, changeZoom, reset,
    style: { width: width * fit, height: height * fit, left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` } };
}
