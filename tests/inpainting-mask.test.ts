import test from "node:test";
import assert from "node:assert/strict";
import { compositeInpainting, prepareInpaintingMasks, requestInpaintingMask } from "../lib/nai/inpainting-composite";
import { opaqueMask } from "../lib/canvas-tools";
import { frameMask } from "../lib/editor-geometry";

function selection(width: number, height: number, selected: (x: number, y: number) => number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, value = selected(x, y);
    pixels.set([value, value, value, 255], i);
  }
  return pixels;
}

test("soft stroke coverage survives exporting and resizing the editor frame", () => {
  const overlay = new Uint8ClampedArray([255,70,160,0, 255,70,160,64, 255,70,160,128, 255,70,160,255]);
  const saved = opaqueMask(overlay);
  assert.deepEqual([saved[0], saved[4], saved[8], saved[12]], [0,64,128,255]);
  assert.deepEqual([...frameMask(overlay, 4, 1, {x:-1,y:0,width:6,height:1})].filter((_,i)=>i%4===3), [255,0,64,128,255,255]);
  assert.deepEqual([...frameMask(overlay, 4, 1, {x:1,y:0,width:2,height:1})].filter((_,i)=>i%4===3), [64,128]);
});

test("only meaningful soft coverage enters the binary HTTP mask", () => {
  const coverage = selection(32, 8, x => x < 8 ? 1 : x < 16 ? 155 : x < 24 ? 156 : 255);
  const wire = requestInpaintingMask(coverage, 32, 8);
  assert.deepEqual([wire[0], wire[8*4], wire[16*4], wire[24*4]], [0,0,255,255]);
  for (let i = 0; i < wire.length; i += 4) {
    assert.ok(wire[i] === 0 || wire[i] === 255);
    assert.equal(wire[i + 3], 255);
  }
  const faint = selection(8, 8, () => 255); for (let i = 3; i < faint.length; i += 4) faint[i] = 155;
  assert.throws(() => requestInpaintingMask(faint, 8, 8), /too small/);
  assert.throws(() => requestInpaintingMask(new Uint8ClampedArray(), 0, 8), /dimensions/);
});

test("round selections produce a smooth composite boundary while preserving distant source pixels", () => {
  const width = 256, height = 256;
  const input = selection(width, height, (x,y) => Math.hypot(x-128,y-128) <= 28 ? 255 : 0);
  const original = input.slice();
  const { requestMask, compositeMask } = prepareInpaintingMasks(input, width, height);
  assert.deepEqual(input, original);
  const alpha = (x: number, y: number) => compositeMask[(y * width + x) * 4 + 3];
  assert.equal(alpha(0,0),0); assert.equal(alpha(255,255),0); assert.equal(alpha(128,128),255);
  const boundary = Array.from({length:100},(_,x)=>alpha(x,128));
  assert.ok(boundary.filter(a=>a>0&&a<255).length > 20);
  assert.ok(boundary.slice(1).every((a,i)=>a>=boundary[i]));
  assert.ok(boundary.slice(1).every((a,i)=>Math.abs(a-boundary[i])<16));
  assert.equal(requestMask[(128*width+64)*4],0);
  assert.ok(alpha(64,128)>0);
  const base = selection(width,height,()=>40), generated = selection(width,height,()=>220);
  const result = compositeInpainting(base,generated,compositeMask);
  assert.deepEqual(result.slice(0,4),base.slice(0,4));
  assert.ok(result[(128*width+64)*4]>40 && result[(128*width+64)*4]<220);
  assert.equal(result[(128*width+128)*4],220);
});

test("outpainting fills every selected transparent pixel and blends into the adjacent original", () => {
  const width=256,height=64;
  const input=selection(width,height,x=>x>=128?255:0),base=selection(width,height,()=>40);
  for(let y=0;y<height;y++)for(let x=128;x<width;x++)base[(y*width+x)*4+3]=0;
  const {compositeMask}=prepareInpaintingMasks(input,width,height,base);
  const result=compositeInpainting(base,selection(width,height,()=>220),compositeMask);
  for(let y=0;y<height;y++)for(let x=128;x<width;x++) {
    const i=(y*width+x)*4; assert.equal(result[i],220);assert.equal(result[i+3],255);
  }
  assert.deepEqual(result.slice(0,4),base.slice(0,4));
  const edge=(32*width+120)*4;assert.ok(result[edge]>40 && result[edge]<220);
});

test("soft replacement uses premultiplied colors without dark transparent fringes", () => {
  const mask=new Uint8ClampedArray([255,255,255,128]);
  assert.deepEqual([...compositeInpainting(new Uint8ClampedArray([0,0,0,0]),new Uint8ClampedArray([230,160,120,255]),mask)], [230,160,120,128]);
  assert.deepEqual([...compositeInpainting(new Uint8ClampedArray([255,0,0,128]),new Uint8ClampedArray([0,0,255,64]),mask)], [170,0,85,96]);
  assert.deepEqual([...compositeInpainting(new Uint8ClampedArray([255,0,0,255]),new Uint8ClampedArray([0,255,0,0]),mask)], [255,0,0,127]);
});

test("full-canvas masks stay fully covered even with a canvas smaller than the blur radius", () => {
  for(const [width,height] of [[8,8],[16,64],[128,128]]) {
    const {compositeMask}=prepareInpaintingMasks(selection(width,height,()=>255),width,height);
    assert.ok(compositeMask.every(v=>v===255));
  }
});
