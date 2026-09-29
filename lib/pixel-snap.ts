/** Browser-only pixel-art cleanup: find a repeated pixel grid, sample its centers, then quantize. */
export function detectPixelSize(data: Uint8ClampedArray, width: number, height: number, conservative = false) {
  const scores: number[] = [];
  for (let step = 2; step <= Math.min(16, width / 8, height / 8); step++) {
    const buckets = new Float64Array(step), counts = new Uint32Array(step);
    for (let y = 1; y < height; y += 3) for (let x = 1; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const dx = Math.abs(data[i] - data[i - 4]) + Math.abs(data[i + 1] - data[i - 3]) + Math.abs(data[i + 2] - data[i - 2]);
      const j = i - width * 4;
      const dy = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      buckets[x % step] += dx; counts[x % step]++;
      buckets[y % step] += dy; counts[y % step]++;
    }
    const mean = buckets.reduce((n,v)=>n+v,0) / Math.max(1, counts.reduce((n,v)=>n+v,0));
    const peak = Math.max(...buckets.map((n,i)=>n/Math.max(1,counts[i])));
    scores[step] = mean ? peak / mean : 0;
  }
  // Natural images have no reliable grid: preserve a fine grid rather than collapsing detail.
  const best = scores.reduce((best, score, step) => score > (scores[best] || 1.6) ? step : best, 1);
  if (best === 1) return conservative ? 2 : 1;
  return best;
}

type Color = { rgb: number[]; count: number };
export function quantizePalette(data: Uint8ClampedArray, count: number) {
  const histogram = new Map<number, Color>();
  for (let i=0;i<data.length;i+=4) if(data[i+3]) {
    const key=(data[i]>>3)<<10 | (data[i+1]>>3)<<5 | data[i+2]>>3;
    const existing=histogram.get(key);
    if(existing)existing.count++;else histogram.set(key,{rgb:[data[i],data[i+1],data[i+2]],count:1});
  }
  const boxes: Color[][] = [[...histogram.values()]];
  const range=(box:Color[],axis:number)=>Math.max(...box.map(c=>c.rgb[axis]))-Math.min(...box.map(c=>c.rgb[axis]));
  while(boxes.length<count) {
    let bi=-1, axis=0, score=-1;
    boxes.forEach((box,i)=>{if(box.length<2)return;for(let a=0;a<3;a++){const s=range(box,a)*Math.sqrt(box.reduce((n,c)=>n+c.count,0));if(s>score){score=s;bi=i;axis=a;}}});
    if(bi<0)break;
    const box=boxes[bi].sort((a,b)=>a.rgb[axis]-b.rgb[axis]);const total=box.reduce((n,c)=>n+c.count,0);let sum=0, split=1;
    for(let i=0;i<box.length-1;i++){sum+=box[i].count;if(sum>=total/2){split=i+1;break;}}
    boxes.splice(bi,1,box.slice(0,split),box.slice(split));
  }
  const palette=boxes.filter(b=>b.length).map(box=>{const total=box.reduce((n,c)=>n+c.count,0);return [0,1,2].map(axis=>Math.round(box.reduce((n,c)=>n+c.rgb[axis]*c.count,0)/total));});
  const cache=new Map<number,number[]>();
  for(let i=0;i<data.length;i+=4)if(data[i+3]){
    const key=data[i]<<16|data[i+1]<<8|data[i+2];let color=cache.get(key);
    if(!color){let distance=Infinity;for(const rgb of palette){const d=rgb.reduce((n,v,j)=>n+(v-data[i+j])**2,0);if(d<distance){distance=d;color=rgb;}}cache.set(key,color!);}
    if(color)for(let c=0;c<3;c++)data[i+c]=color[c];
  }
}

export async function pixelSnap(source: string, options: { colors?: number; conservative?: boolean; upscale?: boolean }) {
  const img=new Image();img.src=source;await img.decode();
  const input=document.createElement("canvas");input.width=img.naturalWidth;input.height=img.naturalHeight;
  const ctx=input.getContext("2d")!;ctx.drawImage(img,0,0);
  const step=detectPixelSize(ctx.getImageData(0,0,input.width,input.height).data,input.width,input.height,options.conservative);
  const output=document.createElement("canvas");output.width=Math.max(1,Math.round(input.width/step));output.height=Math.max(1,Math.round(input.height/step));
  const out=output.getContext("2d")!;out.imageSmoothingEnabled=false;out.drawImage(input,0,0,output.width,output.height);
  if(options.colors){const pixels=out.getImageData(0,0,output.width,output.height);quantizePalette(pixels.data,options.colors);out.putImageData(pixels,0,0);}
  if(options.upscale){ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,input.width,input.height);ctx.drawImage(output,0,0,input.width,input.height);return input.toDataURL("image/png");}
  return output.toDataURL("image/png");
}
