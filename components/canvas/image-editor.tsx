"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */
import { useEffect, useRef, useState } from "react";
import { Pencil, Eraser, PaintBucket, Square, Circle, Minus, Pipette, Undo2, Redo2, Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Download, X, FlipHorizontal, RotateCw, Upload, Hand, Crop, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { floodFill, opaqueMask } from "@/lib/canvas-tools";
import { cn } from "@/lib/utils";
import { useImageViewport } from "@/lib/use-image-viewport";
import { resizeFrame, frameMask, type Frame, type FrameHandle } from "@/lib/editor-geometry";
import { generationSize } from "@/lib/nai/models";
import { useFocusTrap } from "@/lib/use-overlay";

type Tool = "brush" | "eraser" | "fill" | "rectangle" | "ellipse" | "line" | "picker" | "hand" | "frame";
type Layer = { id: number; name: string; url: string; visible: boolean; opacity: number };
type Snapshot = { layers: Layer[]; dimensions: { w: number; h: number }; base: string | null };
const handles: { id: FrameHandle; x: number; y: number; cursor: string }[] = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" }, { id: "n", x: 0.5, y: 0, cursor: "ns-resize" }, { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" }, { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" }, { id: "s", x: 0.5, y: 1, cursor: "ns-resize" }, { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
];
const tools = [{ id: "brush", name: "Draw", icon: Pencil }, { id: "eraser", name: "Eraser", icon: Eraser }, { id: "fill", name: "Fill", icon: PaintBucket }, { id: "line", name: "Line", icon: Minus }, { id: "rectangle", name: "Rectangle", icon: Square }, { id: "ellipse", name: "Ellipse", icon: Circle }, { id: "picker", name: "Pick color", icon: Pipette }] as const;

export function ImageEditor() {
  const editor = useStore(s => s.imageEditor);
  return editor ? <EditorSession key={`${editor.mode}:${editor.source?.length ?? 0}`} mode={editor.mode} source={editor.source} /> : null;
}

function EditorSession({ mode, source }: { mode: "draw" | "mask"; source: string | null }) {
  useLocale();
  const settings = useStore(s => s.settings), patch = useStore(s => s.patchSettings), setUI = useStore(s => s.setUI);
  const [layers, setLayers] = useState<Layer[]>([{ id: 1, name: t(mode === "mask" ? "Mask" : "Layer") + " 1", url: "", visible: true, opacity: 1 }]);
  const [active, setActive] = useState(1), [tool, setTool] = useState<Tool>("brush"), [size, setSize] = useState(20), [color, setColor] = useState("#222222");
  const [brushShape, setBrushShape] = useState<"round" | "soft" | "square">("round");
  const square = brushShape === "square";
  const [initial] = useState(() => {
    const input = source && settings.imageSource?.dataUrl === source ? settings.imageSource : null;
    const size = input ? generationSize(input.width, input.height) : { width: settings.width, height: settings.height };
    return { dimensions: { w: size.width, h: size.height }, output: { width: settings.width, height: settings.height }, hasInput: !!input };
  });
  const [dimensions, setDimensions] = useState(initial.dimensions);
  const [base, setBase] = useState(source), [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]), [future, setFuture] = useState<Snapshot[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null), [space, setSpace] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const frameDrag = useRef<{ handle: FrameHandle; x: number; y: number; frame: Frame; scale: number } | null>(null);
  const ready = useRef(false);
  const panel = useFocusTrap<HTMLDivElement>(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ x: number; y: number; before: ImageData; stroke?: HTMLCanvasElement } | null>(null), nextId = useRef(2), file = useRef<HTMLInputElement>(null);
  const { w, h } = dimensions;
  const { container: viewportContainer, zoom: viewportZoom, fit: viewportFit, scale: viewportScale, panning: viewportPanning, startPan: viewportStartPan, movePan: viewportMovePan, endPan: viewportEndPan, changeZoom: viewportChangeZoom, reset: viewportReset, style: viewportStyle } = useImageViewport(w, h);
  // Size is measured on screen; compensate the stroke and cursor together so
  // zooming in can paint finer details without enlarging the brush.
  const brushSize = size / (viewportScale || 1);
  const current = layers.find(l => l.id === active)!;

  useEffect(() => {
    let cancelled = false;
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ready.current = false;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    if (current?.url) { const img = new Image(); img.onload = () => { if (!cancelled) { ctx.drawImage(img, 0, 0, c.width, c.height); ready.current = true; } }; img.src = current.url; }
    else ready.current = true;
    return () => { cancelled = true; };
  }, [active, current?.url, w, h]);

  useEffect(() => {
    toast.dismiss("recipe-import");
    if (!source) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (mode === "draw") {
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        setLayers([{ id: 1, name: t("Base image"), url: c.toDataURL("image/png"), visible: true, opacity: 1 }]);
      }
    };
    img.src = source;
    return () => { cancelled = true; };
    // The session is recreated when another image is opened, not while the drawing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      e.preventDefault(); setSpace(e.type === "keydown");
    };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, []);

  useEffect(() => {
    if (mode !== "mask" || !settings.imageSource?.mask || settings.imageSource.dataUrl !== source) return;
    let cancelled = false;
    const img = new Image(); img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h); for (let i = 0; i < data.data.length; i += 4) { data.data[i + 3] = Math.round(data.data[i] * data.data[i + 3] / 255); data.data[i] = 255; data.data[i + 1] = 70; data.data[i + 2] = 160; } ctx.putImageData(data, 0, 0);
      setLayers([{ id: 1, name: t("Mask"), url: c.toDataURL("image/png"), visible: true, opacity: 1 }]);
    }; img.src = settings.imageSource.mask;
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshot = (): Snapshot => ({ layers: layers.map(l => ({ ...l })), dimensions, base });
  const checkpoint = () => { setHistory(h => [...h.slice(-19), snapshot()]); setFuture([]); };
  const commit = () => { if (canvas.current) setLayers(ls => ls.map(l => l.id === active ? { ...l, url: canvas.current!.toDataURL("image/png") } : l)); };
  const restore = (s: Snapshot) => { setLayers(s.layers); setDimensions(s.dimensions); setBase(s.base); setActive(s.layers.at(-1)!.id); setFrame(null); viewportReset(); };
  const undo = () => { if (!history.length || busy || gesture.current) return; setFuture(f => [snapshot(), ...f]); restore(history[history.length - 1]); setHistory(history.slice(0, -1)); };
  const redo = () => { if (!future.length || busy || gesture.current) return; setHistory(h => [...h, snapshot()]); restore(future[0]); setFuture(future.slice(1)); };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * w, y: (e.clientY - r.top) / r.height * h }; };
  const style = (ctx: CanvasRenderingContext2D) => { ctx.lineWidth = brushSize; ctx.lineCap = square ? "square" : "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ctx.fillStyle = mode === "mask" ? "#ff46a0" : color; ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over"; };
  const renderStroke = (ctx: CanvasRenderingContext2D, g: NonNullable<typeof gesture.current>) => {
    const stroke = g.stroke!, strokeCtx = stroke.getContext("2d")!;
    strokeCtx.clearRect(0, 0, w, h); strokeCtx.stroke();
    // Composite the whole stroke once; repeated pointer events must not harden its soft edge.
    ctx.putImageData(g.before, 0, 0); ctx.save();
    ctx.filter = brushShape === "soft" ? `blur(${brushSize * 0.15}px)` : "none";
    ctx.drawImage(stroke, 0, 0); ctx.restore();
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || (e.button === 0 && (tool === "hand" || space))) { e.preventDefault(); viewportStartPan(e); setCursor(null); return; }
    if (e.button !== 0 || busy || tool === "frame" || !ready.current || !current.visible) return;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e); e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "picker") { const rgba = ctx.getImageData(Math.min(w-1,Math.max(0,p.x)), Math.min(h-1,Math.max(0,p.y)), 1, 1).data; setColor("#" + [...rgba].slice(0,3).map(n=>n.toString(16).padStart(2,"0")).join("")); return; }
    checkpoint(); style(ctx);
    if (tool === "fill") { const data = ctx.getImageData(0, 0, w, h); const hex = mode === "mask" ? "#ff46a0" : color; floodFill(data.data, w, h, p.x, p.y, [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16),255]); ctx.putImageData(data,0,0); commit(); return; }
    gesture.current = { ...p, before: ctx.getImageData(0,0,w,h) }; ctx.beginPath(); ctx.moveTo(p.x,p.y);
    if (tool === "brush" || tool === "eraser") {
      const stroke = document.createElement("canvas"); stroke.width = w; stroke.height = h;
      const strokeCtx = stroke.getContext("2d")!; style(strokeCtx); strokeCtx.globalCompositeOperation = "source-over";
      strokeCtx.beginPath(); strokeCtx.moveTo(p.x, p.y); strokeCtx.lineTo(p.x + 0.01, p.y);
      gesture.current.stroke = stroke; renderStroke(ctx, gesture.current);
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (viewportMovePan(e)) { setCursor(null); return; }
    const position = point(e); setCursor(position);
    if (!gesture.current) return;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e), g = gesture.current; style(ctx);
    if (g.stroke) {
      if (p.x === g.x && p.y === g.y) return;
      g.stroke.getContext("2d")!.lineTo(p.x,p.y); g.x = p.x; g.y = p.y;
      renderStroke(ctx, g); return;
    }
    ctx.putImageData(g.before,0,0); ctx.beginPath();
    if (tool === "line") { ctx.moveTo(g.x,g.y); ctx.lineTo(p.x,p.y); }
    if (tool === "rectangle") ctx.rect(g.x,g.y,p.x-g.x,p.y-g.y);
    if (tool === "ellipse") ctx.ellipse((g.x+p.x)/2,(g.y+p.y)/2,Math.abs(p.x-g.x)/2,Math.abs(p.y-g.y)/2,0,0,Math.PI*2);
    ctx.stroke();
  };
  const up = () => { viewportEndPan(); if (gesture.current) { gesture.current = null; commit(); } };

  const composite = async () => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d")!;
    for (const layer of layers) if (layer.visible && layer.url) { const img = new Image(); img.src = layer.url; await img.decode(); ctx.globalAlpha = layer.opacity; ctx.drawImage(img,0,0,w,h); }
    ctx.globalAlpha = 1;
    return c;
  };
  const applyFrame = async (next: Frame) => {
    if (![next.width, next.height].every(n=>Number.isInteger(n)&&n>=64&&n<=2048&&n%64===0) || next.width*next.height>3145728) return;
    if (busy || (next.x === 0 && next.y === 0 && next.width === w && next.height === h)) { setFrame(null); return; }
    setBusy(true);
    try {
      const translate = async (url: string) => {
        const c = document.createElement("canvas"); c.width = next.width; c.height = next.height;
        if (url) { const img = new Image(); img.src = url; await img.decode(); c.getContext("2d")!.drawImage(img, -next.x, -next.y, w, h); }
        return c.toDataURL("image/png");
      };
      const nextBase = base ? await translate(base) : null;
      let nextLayers: Layer[];
      if (mode === "mask") {
        const merged = await composite();
        const pixels = merged.getContext("2d")!.getImageData(0, 0, w, h);
        const mask = document.createElement("canvas"); mask.width = next.width; mask.height = next.height;
        const ctx = mask.getContext("2d")!, result = ctx.createImageData(next.width, next.height);
        result.data.set(frameMask(pixels.data, w, h, next)); ctx.putImageData(result, 0, 0);
        nextLayers = [{ id: nextId.current++, name: t("Mask"), url: mask.toDataURL("image/png"), visible: true, opacity: 1 }];
      } else nextLayers = await Promise.all(layers.map(async l => ({ ...l, url: l.url ? await translate(l.url) : "" })));
      checkpoint(); setBase(nextBase); setDimensions({ w: next.width, h: next.height }); setLayers(nextLayers); setActive(nextLayers.at(-1)!.id); setFrame(null); viewportReset();
    } catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  };
  const frameDown = (e: React.PointerEvent, handle: FrameHandle) => {
    if (busy) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    frameDrag.current = { handle, x: e.clientX, y: e.clientY, frame: frame ?? { x: 0, y: 0, width: w, height: h }, scale: viewportScale };
    setCursor(null);
  };
  const frameMove = (e: React.PointerEvent) => {
    const drag = frameDrag.current; if (!drag || !drag.scale) return;
    setFrame(resizeFrame(drag.frame, drag.handle, (e.clientX - drag.x) / drag.scale, (e.clientY - drag.y) / drag.scale));
  };
  const frameUp = (e: React.PointerEvent) => {
    const drag = frameDrag.current; if (!drag || !drag.scale) return;
    const next = resizeFrame(drag.frame, drag.handle, (e.clientX - drag.x) / drag.scale, (e.clientY - drag.y) / drag.scale);
    frameDrag.current = null; void applyFrame(next);
  };
  const save = async () => {
    if (busy || gesture.current) return;
    setBusy(true);
    try {
      const c = await composite();
      if (mode === "mask") {
        const ctx = c.getContext("2d")!, pixels = ctx.getImageData(0,0,w,h);
        if (!pixels.data.some((v,i) => i % 4 === 3 && v > 0)) { toast.error(t("Draw a mask first.")); return; }
        pixels.data.set(opaqueMask(pixels.data)); ctx.putImageData(pixels,0,0);
        const input = document.createElement("canvas"); input.width = w; input.height = h;
        if (base) { const img = new Image(); img.src = base; await img.decode(); input.getContext("2d")!.drawImage(img, 0, 0, w, h); }
        const output = initial.hasInput && w === initial.dimensions.w && h === initial.dimensions.h ? initial.output : { width: w, height: h };
        patch({ ...output, imageSource: { dataUrl: input.toDataURL("image/png"), width:w, height:h, mask:c.toDataURL("image/png"), mode:"infill", strength:settings.imageSource?.strength ?? 0.7, noise:0, inpaintStrength:settings.imageSource?.inpaintStrength ?? 1, focused: settings.imageSource?.focused ?? false } });
      } else patch({ width:w,height:h,imageSource:{ dataUrl:c.toDataURL("image/png"),width:w,height:h,mode:"img2img",strength:settings.imageSource?.strength ?? 0.7,noise:settings.imageSource?.noise ?? 0,inpaintStrength:1 } });
      setUI({ imageEditor:null,settingsCollapsed:false });
    } catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  };
  const transform = (rotate: boolean) => {
    const src=canvas.current;if(!src)return;checkpoint();const c=document.createElement("canvas"); c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.translate(w/2,h/2); if(rotate){ctx.rotate(Math.PI/2);ctx.drawImage(src,-h/2,-w/2,h,w);}else{ctx.scale(-1,1);ctx.drawImage(src,-w/2,-h/2);}const target=src.getContext("2d")!;target.globalCompositeOperation="source-over";target.clearRect(0,0,w,h);target.drawImage(c,0,0);commit();
  };
  const add = () => { checkpoint();const id=nextId.current++;setLayers(ls=>[...ls,{id,name:`${t("Layer")} ${id}`,url:"",visible:true,opacity:1}]);setActive(id); };

  return <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t(mode === "mask" ? "Draw mask" : "Image editor")} className="fixed inset-0 z-[100] flex flex-col bg-bg text-fg" onKeyDown={e=>{if(e.key === "Escape"){e.stopPropagation();setUI({imageEditor:null});}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!(e.target instanceof HTMLInputElement)){e.preventDefault();if(e.shiftKey)redo();else undo();}}}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-border-soft bg-surface p-2">
        <span className="text-xs font-semibold">{t(mode === "mask" ? "Draw mask" : "Draw")}</span>
        {mode === "draw" && <input type="color" aria-label={t("Brush color")} value={color} onChange={e=>setColor(e.target.value)} className="h-8 w-12 bg-transparent" />}
        <label className="text-xs">{t("Pen size")} <input type="number" min={1} max={300} value={size} onChange={e=>setSize(Math.max(1,Math.min(300,Number(e.target.value))))} className="w-12 bg-bg px-1" /><input type="range" min={1} max={300} value={size} onChange={e=>setSize(Number(e.target.value))} aria-label={t("Pen size")} className="mt-2 block w-32 accent-accent" /></label>
        <label className="text-xs">{t("Brush shape")} <select aria-label={t("Brush shape")} value={brushShape} onChange={e=>setBrushShape(e.target.value as typeof brushShape)} className="ml-1 rounded border border-border-soft bg-bg px-1 py-1">
          <option value="round">{t("Round brush")}</option><option value="soft">{t("Soft round brush")}</option><option value="square">{t("Square brush")}</option>
        </select></label>
      </div>
      <div className="flex items-center gap-1"><IconButton label={t("Download canvas")} onClick={()=>void composite().then(c=>{const a=document.createElement("a");a.href=c.toDataURL("image/png");a.download="canvas.png";a.click();})}><Download /></IconButton><Button disabled={busy} onClick={()=>void save()}>{t("Save and close")}</Button><IconButton label={t("Close editor")} onClick={()=>setUI({imageEditor:null})}><X /></IconButton></div>
    </header>
    {tool === "frame" && <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-3 pb-3 text-xs">
      <span>{t("Canvas size")}</span>
      {(["width", "height"] as const).map(key=><label key={key}>{t(key === "width" ? "Width" : "Height")} <input type="number" min={64} max={2048} step={64} aria-label={t(key === "width" ? "Canvas width" : "Canvas height")}
        value={frame?.[key] ?? (key === "width" ? w : h)} onChange={e=>{const value=Number(e.target.value);if(!Number.isFinite(value))return;setFrame(old=>({...old??{x:0,y:0,width:w,height:h},[key]:Math.max(64,Math.min(2048,Math.round(value/64)*64))}));}} className="ml-1 w-20 rounded border border-border-soft bg-bg px-2 py-1" /></label>)}
      <Button size="sm" disabled={!frame || busy || frame.width*frame.height>3145728} onClick={()=>frame&&void applyFrame(frame)}>{t("Apply canvas size")}</Button>
      {frame && <button type="button" onClick={()=>setFrame(null)}>{t("Cancel")}</button>}
    </div>}
    <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
      <div ref={viewportContainer} aria-label={t("Editor viewport")} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded bg-surface-2 touch-none"
        onPointerDown={e => { if (e.target === e.currentTarget && (e.button === 1 || tool === "hand" || space)) { e.preventDefault(); viewportStartPan(e); } }} onPointerMove={e => { if (e.target === e.currentTarget) viewportMovePan(e); }} onPointerUp={viewportEndPan} onPointerCancel={viewportEndPan}>
        <div className="checkerboard absolute" style={viewportStyle}>
          {mode === "mask" && base && <img src={base} alt="" className="pointer-events-none absolute inset-0 h-full w-full" />}
          {layers.map(layer=>layer.id===active ? <canvas key={layer.id} ref={canvas} width={w} height={h} aria-label={t("Drawing canvas")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={()=>setCursor(null)} className="absolute inset-0 h-full w-full touch-none" style={{opacity:layer.visible?layer.opacity*(mode==="mask"?0.55:1):0,zIndex:layers.indexOf(layer)+1,cursor:tool==="hand"||space?viewportPanning?"grabbing":"grab":tool==="brush"||tool==="eraser"?"none":"crosshair"}} /> : layer.visible&&layer.url ? <img key={layer.id} src={layer.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full" style={{opacity:layer.opacity,zIndex:layers.indexOf(layer)+1}} /> : null)}
          {cursor && !space && !viewportPanning && (tool === "brush" || tool === "eraser") && <div aria-hidden data-brush-outline className="pointer-events-none absolute z-40 border border-white shadow-[0_0_0_1px_#222]" style={{ left: cursor.x / w * 100 + "%", top: cursor.y / h * 100 + "%", width: brushSize / w * 100 + "%", height: brushSize / h * 100 + "%", transform: "translate(-50%, -50%)", borderRadius: square ? 0 : "50%", borderWidth: 1 / viewportZoom }} />}
          {(mode === "mask" || tool === "frame") && <div className="pointer-events-none absolute z-50 border-2 border-accent" style={{ left: (frame?.x ?? 0) / w * 100 + "%", top: (frame?.y ?? 0) / h * 100 + "%", width: (frame?.width ?? w) / w * 100 + "%", height: (frame?.height ?? h) / h * 100 + "%", borderWidth: 1 / viewportZoom }}>
            {frame && <span className="absolute bottom-full left-0 whitespace-nowrap bg-bg px-2 py-1 text-xs" style={{ transformOrigin: "bottom left", transform: `scale(${1 / viewportZoom})` }}>{frame.width} × {frame.height}</span>}
            {handles.map(handle => <button key={handle.id} type="button" aria-label={t("Resize canvas {0}", handle.id)} title={t("Drag inward to crop, outward to expand")}
              onPointerDown={e=>frameDown(e,handle.id)} onPointerMove={frameMove} onPointerUp={frameUp} onPointerCancel={()=>{frameDrag.current=null;setFrame(null);}}
              className="pointer-events-auto absolute rounded-sm border border-white bg-accent touch-none" style={{ left: handle.x * 100 + "%", top: handle.y * 100 + "%", width: 12 / viewportZoom, height: 12 / viewportZoom, transform: "translate(-50%, -50%)", cursor: handle.cursor }} />)}
          </div>}
        </div>
      </div>
      <aside className="flex w-20 sm:w-28 shrink-0 flex-col gap-2 overflow-y-auto rounded border border-border-soft bg-surface p-2">
        <div className="flex justify-between"><IconButton size="sm" label={t("Add layer")} onClick={add}><Plus /></IconButton><IconButton size="sm" label={t("Upload layer")} onClick={()=>file.current?.click()}><Upload /></IconButton></div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;const url=URL.createObjectURL(f);try{const img=new Image();img.src=url;await img.decode();const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d")!.drawImage(img,0,0,w,h);checkpoint();const id=nextId.current++;setLayers(ls=>[...ls,{id,name:f.name,url:c.toDataURL("image/png"),visible:true,opacity:1}]);setActive(id);}finally{URL.revokeObjectURL(url);e.target.value="";}}} />
        {[...layers].reverse().map(layer=><div key={layer.id} className={cn("rounded border p-1",active===layer.id?"border-accent":"border-border-soft")}>
          <button className="checkerboard block aspect-square w-full overflow-hidden" aria-label={`${t("Select layer")} ${layer.id}`} onClick={()=>setActive(layer.id)}>{layer.url&&<img src={layer.url} alt="" className="h-full w-full object-contain" />}</button>
          <input aria-label={`${t("Layer name")} ${layer.id}`} value={layer.name} onChange={e=>setLayers(ls=>ls.map(l=>l.id===layer.id?{...l,name:e.target.value}:l))} className="w-full bg-transparent text-[10px]" />
          <div className="flex"><IconButton size="sm" label={t("Toggle layer visibility")} onClick={()=>{checkpoint();setLayers(ls=>ls.map(l=>l.id===layer.id?{...l,visible:!l.visible}:l));}}>{layer.visible?<Eye/>:<EyeOff/>}</IconButton><IconButton size="sm" label={t("Delete layer")} disabled={layers.length===1} onClick={()=>{checkpoint();const ls=layers.filter(l=>l.id!==layer.id);setLayers(ls);if(active===layer.id)setActive(ls.at(-1)!.id);}}><Trash2/></IconButton></div>
        </div>)}
        <label className="text-[10px]">{t("Layer opacity")}<input type="range" min={0} max={1} step={0.05} value={current?.opacity??1} onChange={e=>setLayers(ls=>ls.map(l=>l.id===active?{...l,opacity:Number(e.target.value)}:l))} className="w-full accent-accent" /></label>
        <div className="flex">{[-1,1].map(delta=><IconButton key={delta} size="sm" label={t(delta>0?"Move layer up":"Move layer down")} onClick={()=>{const i=layers.findIndex(l=>l.id===active),j=i+delta;if(j<0||j>=layers.length)return;checkpoint();const ls=[...layers];[ls[i],ls[j]]=[ls[j],ls[i]];setLayers(ls);}}>{delta>0?<ChevronUp/>:<ChevronDown/>}</IconButton>)}</div>
      </aside>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-border-soft bg-surface p-2">
      {tools.filter(tool=>mode!=="mask"||!["picker","ellipse","rectangle","line"].includes(tool.id)).map(({id,name,icon:Icon})=><IconButton key={id} label={t(name)} aria-pressed={tool===id} className={tool===id?"bg-surface-3 text-accent":""} onClick={()=>setTool(id)}><Icon/></IconButton>)}
      <IconButton label={t("Pan canvas")} aria-pressed={tool==="hand"} className={tool==="hand"?"bg-surface-3 text-accent":""} onClick={()=>{setTool("hand");setCursor(null);}}><Hand /></IconButton>
      <IconButton label={t("Crop / expand canvas")} aria-pressed={tool==="frame"} className={tool==="frame"?"bg-surface-3 text-accent":""} onClick={()=>{setTool("frame");setCursor(null);}}><Crop /></IconButton>
      <span className="mx-2 h-6 border-l border-border"/>
      <IconButton label={t("Flip horizontally")} onClick={()=>transform(false)}><FlipHorizontal/></IconButton><IconButton label={t("Rotate layer")} onClick={()=>transform(true)}><RotateCw/></IconButton>
      <IconButton label={t("Clear layer")} onClick={()=>{checkpoint();canvas.current?.getContext("2d")?.clearRect(0,0,w,h);commit();}}><Trash2/></IconButton>
      <IconButton label={t("Undo")} disabled={!history.length} onClick={undo}><Undo2/></IconButton><IconButton label={t("Redo")} disabled={!future.length} onClick={redo}><Redo2/></IconButton>
      <IconButton label={t("Zoom out")} onClick={()=>viewportChangeZoom(viewportZoom/1.25)}><ZoomOut /></IconButton><IconButton label={t("Zoom in")} onClick={()=>viewportChangeZoom(viewportZoom*1.25)}><ZoomIn /></IconButton><IconButton label={t("Fit canvas")} onClick={viewportReset}><Maximize /></IconButton>
      <button className="px-2 text-xs tabular-nums" title={t("Actual size")} disabled={!viewportFit} onClick={()=>viewportChangeZoom(1 / viewportFit)}>{Math.round(viewportScale*100)}%</button>
      <span className="ml-3 text-xs text-muted">{w} × {h}</span>
    </footer>
  </div>;
}
