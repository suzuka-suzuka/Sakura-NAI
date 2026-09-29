"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local image data URLs need no remote optimization. */
import { useEffect, useRef, useState } from "react";
import { Pencil, Eraser, PaintBucket, Square, Circle, Minus, Pipette, Undo2, Redo2, Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Download, X, FlipHorizontal, RotateCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { translateUI as t, useLocale } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { floodFill, opaqueMask } from "@/lib/canvas-tools";
import { cn } from "@/lib/utils";
import { useFitCanvas } from "@/lib/use-fit-canvas";
import { useFocusTrap } from "@/lib/use-overlay";

type Tool = "brush" | "eraser" | "fill" | "rectangle" | "ellipse" | "line" | "picker";
type Layer = { id: number; name: string; url: string; visible: boolean; opacity: number };
const tools = [{ id: "brush", name: "Draw", icon: Pencil }, { id: "eraser", name: "Eraser", icon: Eraser }, { id: "fill", name: "Fill", icon: PaintBucket }, { id: "line", name: "Line", icon: Minus }, { id: "rectangle", name: "Rectangle", icon: Square }, { id: "ellipse", name: "Ellipse", icon: Circle }, { id: "picker", name: "Pick color", icon: Pipette }] as const;

export function ImageEditor() {
  const editor = useStore(s => s.imageEditor);
  return editor ? <EditorSession key={`${editor.mode}:${editor.source?.length ?? 0}`} mode={editor.mode} source={editor.source} /> : null;
}

function EditorSession({ mode, source }: { mode: "draw" | "mask"; source: string | null }) {
  useLocale();
  const settings = useStore(s => s.settings), patch = useStore(s => s.patchSettings), setUI = useStore(s => s.setUI);
  const [layers, setLayers] = useState<Layer[]>([{ id: 1, name: t(mode === "mask" ? "Mask" : "Layer") + " 1", url: "", visible: true, opacity: 1 }]);
  const [active, setActive] = useState(1), [tool, setTool] = useState<Tool>("brush"), [size, setSize] = useState(20), [color, setColor] = useState("#222222"), [square, setSquare] = useState(false);
  const [dimensions] = useState({ w: settings.width, h: settings.height });
  const [history, setHistory] = useState<Layer[][]>([]), [future, setFuture] = useState<Layer[][]>([]);
  const ready = useRef(false);
  const panel = useFocusTrap<HTMLDivElement>(true);
  const canvas = useRef<HTMLCanvasElement>(null), original = useRef<HTMLImageElement | null>(null);
  const gesture = useRef<{ x: number; y: number; before: ImageData } | null>(null), nextId = useRef(2), file = useRef<HTMLInputElement>(null);
  const { w, h } = dimensions;
  const { container: fitContainer, size: fitSize } = useFitCanvas(w, h);
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
    if (!source) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      original.current = img;
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
    if (mode !== "mask" || !settings.imageSource?.mask || settings.imageSource.dataUrl !== source) return;
    let cancelled = false;
    const img = new Image(); img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h); for (let i = 0; i < data.data.length; i += 4) { data.data[i + 3] = data.data[i] > 127 ? 255 : 0; data.data[i] = 255; data.data[i + 1] = 70; data.data[i + 2] = 160; } ctx.putImageData(data, 0, 0);
      setLayers([{ id: 1, name: t("Mask"), url: c.toDataURL("image/png"), visible: true, opacity: 1 }]);
    }; img.src = settings.imageSource.mask;
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkpoint = () => { setHistory(h => [...h.slice(-19), layers.map(l => ({ ...l }))]); setFuture([]); };
  const commit = () => { if (canvas.current) setLayers(ls => ls.map(l => l.id === active ? { ...l, url: canvas.current!.toDataURL("image/png") } : l)); };
  const undo = () => { if (!history.length) return; setFuture(f => [layers, ...f]); setLayers(history[history.length - 1]); setActive(history[history.length - 1].at(-1)!.id); setHistory(history.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setHistory(h => [...h, layers]); setLayers(future[0]); setActive(future[0].at(-1)!.id); setFuture(future.slice(1)); };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * w, y: (e.clientY - r.top) / r.height * h }; };
  const style = (ctx: CanvasRenderingContext2D) => { ctx.lineWidth = size; ctx.lineCap = square ? "square" : "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ctx.fillStyle = mode === "mask" ? "#ff46a0" : color; ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over"; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready.current || !current.visible) return;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e); e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "picker") { const rgba = ctx.getImageData(Math.min(w-1,Math.max(0,p.x)), Math.min(h-1,Math.max(0,p.y)), 1, 1).data; setColor("#" + [...rgba].slice(0,3).map(n=>n.toString(16).padStart(2,"0")).join("")); return; }
    checkpoint(); style(ctx);
    if (tool === "fill") { const data = ctx.getImageData(0, 0, w, h); const hex = mode === "mask" ? "#ff46a0" : color; floodFill(data.data, w, h, p.x, p.y, [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16),255]); ctx.putImageData(data,0,0); commit(); return; }
    gesture.current = { ...p, before: ctx.getImageData(0,0,w,h) }; ctx.beginPath(); ctx.moveTo(p.x,p.y);
    if (tool === "brush" || tool === "eraser") { ctx.lineTo(p.x + 0.01,p.y); ctx.stroke(); }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!gesture.current) return;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e), g = gesture.current; style(ctx);
    if (tool === "brush" || tool === "eraser") { ctx.lineTo(p.x,p.y); ctx.stroke(); return; }
    ctx.putImageData(g.before,0,0); ctx.beginPath();
    if (tool === "line") { ctx.moveTo(g.x,g.y); ctx.lineTo(p.x,p.y); }
    if (tool === "rectangle") ctx.rect(g.x,g.y,p.x-g.x,p.y-g.y);
    if (tool === "ellipse") ctx.ellipse((g.x+p.x)/2,(g.y+p.y)/2,Math.abs(p.x-g.x)/2,Math.abs(p.y-g.y)/2,0,0,Math.PI*2);
    ctx.stroke();
  };
  const up = () => { if (gesture.current) { gesture.current = null; commit(); } };

  const composite = async () => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d")!;
    for (const layer of layers) if (layer.visible && layer.url) { const img = new Image(); img.src = layer.url; await img.decode(); ctx.globalAlpha = layer.opacity; ctx.drawImage(img,0,0,w,h); }
    ctx.globalAlpha = 1;
    return c;
  };
  const save = async () => {
    try {
      const c = await composite();
      if (mode === "mask") {
        const ctx = c.getContext("2d")!, pixels = ctx.getImageData(0,0,w,h);
        if (!pixels.data.some((v,i) => i % 4 === 3 && v > 0)) { toast.error(t("Draw a mask first.")); return; }
        pixels.data.set(opaqueMask(pixels.data)); ctx.putImageData(pixels,0,0);
        const base = document.createElement("canvas"); base.width = w; base.height = h; if (original.current) base.getContext("2d")!.drawImage(original.current,0,0,w,h);
        patch({ width:w, height:h, imageSource: { dataUrl: base.toDataURL("image/png"), width:w, height:h, mask:c.toDataURL("image/png"), mode:"infill", strength:settings.imageSource?.strength ?? 0.7, noise:0, inpaintStrength:settings.imageSource?.inpaintStrength ?? 1 } });
      } else patch({ width:w,height:h,imageSource:{ dataUrl:c.toDataURL("image/png"),width:w,height:h,mode:"img2img",strength:settings.imageSource?.strength ?? 0.7,noise:settings.imageSource?.noise ?? 0,inpaintStrength:1 } });
      setUI({ imageEditor:null,settingsCollapsed:false });
    } catch (error) { toast.error(String(error)); }
  };
  const transform = (rotate: boolean) => {
    const src=canvas.current;if(!src)return;checkpoint();const c=document.createElement("canvas"); c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.translate(w/2,h/2); if(rotate){ctx.rotate(Math.PI/2);ctx.drawImage(src,-h/2,-w/2,h,w);}else{ctx.scale(-1,1);ctx.drawImage(src,-w/2,-h/2);}const target=src.getContext("2d")!;target.globalCompositeOperation="source-over";target.clearRect(0,0,w,h);target.drawImage(c,0,0);commit();
  };
  const add = () => { checkpoint();const id=nextId.current++;setLayers(ls=>[...ls,{id,name:`${t("Layer")} ${id}`,url:"",visible:true,opacity:1}]);setActive(id); };

  return <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t(mode === "mask" ? "Draw mask" : "Image editor")} className="fixed inset-0 z-[100] flex flex-col bg-bg text-fg" onKeyDown={e=>{if(e.key === "Escape"){e.stopPropagation();setUI({imageEditor:null});}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!(e.target instanceof HTMLInputElement)){e.preventDefault();if(e.shiftKey)redo();else undo();}}}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex items-center gap-3 rounded border border-border-soft bg-surface p-2">
        <span className="text-xs font-semibold">{t(mode === "mask" ? "Draw mask" : "Draw")}</span>
        {mode === "draw" && <input type="color" aria-label={t("Brush color")} value={color} onChange={e=>setColor(e.target.value)} className="h-8 w-12 bg-transparent" />}
        <label className="text-xs">{t("Pen size")} <input type="number" min={1} max={300} value={size} onChange={e=>setSize(Math.max(1,Math.min(300,Number(e.target.value))))} className="w-12 bg-bg px-1" /><input type="range" min={1} max={300} value={size} onChange={e=>setSize(Number(e.target.value))} aria-label={t("Pen size")} className="mt-2 block w-32 accent-accent" /></label>
        <label className="text-xs"><input type="checkbox" checked={square} onChange={e=>setSquare(e.target.checked)} className="mr-1 accent-accent" />{t("Square brush")}</label>
      </div>
      <div className="flex items-center gap-1"><IconButton label={t("Download canvas")} onClick={()=>void composite().then(c=>{const a=document.createElement("a");a.href=c.toDataURL("image/png");a.download="canvas.png";a.click();})}><Download /></IconButton><Button onClick={()=>void save()}>{t("Save and close")}</Button><IconButton label={t("Close editor")} onClick={()=>setUI({imageEditor:null})}><X /></IconButton></div>
    </header>
    <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
      <div ref={fitContainer} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <div className="checkerboard relative overflow-hidden" style={fitSize}>
          {mode === "mask" && source && <img src={source} alt="" className="pointer-events-none absolute inset-0 h-full w-full" />}
          {layers.map(layer=>layer.id===active ? <canvas key={layer.id} ref={canvas} width={w} height={h} aria-label={t("Drawing canvas")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="absolute inset-0 h-full w-full touch-none" style={{opacity:layer.visible?layer.opacity*(mode==="mask"?0.55:1):0,zIndex:layers.indexOf(layer)+1,cursor:"crosshair"}} /> : layer.visible&&layer.url ? <img key={layer.id} src={layer.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full" style={{opacity:layer.opacity,zIndex:layers.indexOf(layer)+1}} /> : null)}
        </div>
      </div>
      <aside className="flex w-28 shrink-0 flex-col gap-2 overflow-y-auto rounded border border-border-soft bg-surface p-2">
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
      <span className="mx-2 h-6 border-l border-border"/>
      <IconButton label={t("Flip horizontally")} onClick={()=>transform(false)}><FlipHorizontal/></IconButton><IconButton label={t("Rotate layer")} onClick={()=>transform(true)}><RotateCw/></IconButton>
      <IconButton label={t("Clear layer")} onClick={()=>{checkpoint();canvas.current?.getContext("2d")?.clearRect(0,0,w,h);commit();}}><Trash2/></IconButton>
      <IconButton label={t("Undo")} disabled={!history.length} onClick={undo}><Undo2/></IconButton><IconButton label={t("Redo")} disabled={!future.length} onClick={redo}><Redo2/></IconButton>
      <span className="ml-3 text-xs text-muted">{w} × {h}</span>
    </footer>
  </div>;
}
