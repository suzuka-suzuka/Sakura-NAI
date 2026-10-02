export type Point = { x: number; y: number };
export type Frame = Point & { width: number; height: number };
export type FrameHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Keep the pixel under the pointer fixed as the viewport zoom changes. */
export function zoomAt(pan: Point, pointer: Point, ratio: number): Point {
  return { x: pointer.x + (pan.x - pointer.x) * ratio, y: pointer.y + (pan.y - pointer.y) * ratio };
}

/** Crop/expand on the model's 64px grid, with the opposite edge held in place. */
export function resizeFrame(frame: Frame, handle: FrameHandle, dx: number, dy: number): Frame {
  const right = frame.x + frame.width, bottom = frame.y + frame.height;
  let x = frame.x, y = frame.y, width = frame.width, height = frame.height;
  const snap = (v: number) => Math.round(v / 64) * 64;
  if (handle.includes("w")) { width = Math.max(64, Math.min(2048, right - snap(frame.x + dx))); x = right - width; }
  if (handle.includes("e")) width = Math.max(64, Math.min(2048, snap(frame.width + dx)));
  if (handle.includes("n")) { height = Math.max(64, Math.min(2048, bottom - snap(frame.y + dy))); y = bottom - height; }
  if (handle.includes("s")) height = Math.max(64, Math.min(2048, snap(frame.height + dy)));
  while (width * height > 3145728) {
    if (handle === "n" || handle === "s" || (handle.length === 2 && height >= width)) height -= 64;
    else width -= 64;
  }
  if (handle.includes("w")) x = right - width;
  if (handle.includes("n")) y = bottom - height;
  return { x, y, width, height };
}

/** New canvas pixels outside the source are selected automatically for outpainting. */
export function frameMask(data: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, frame: Frame) {
  const result = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const sx = x + frame.x, sy = y + frame.y, i = (y * frame.width + x) * 4;
    const outside = sx < 0 || sy < 0 || sx >= sourceWidth || sy >= sourceHeight;
    if (outside || data[(sy * sourceWidth + sx) * 4 + 3] > 0) {
      result[i] = 255; result[i + 1] = 70; result[i + 2] = 160;
      result[i + 3] = outside ? 255 : data[(sy * sourceWidth + sx) * 4 + 3];
    }
  }
  return result;
}

/** Bound all selected pixels, add context, and prefer the requested aspect ratio. */
export function focusedCrop(mask: Uint8ClampedArray, width: number, height: number, aspect: number, padding = 96): Frame | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[(y * width + x) * 4] > 127) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) return null;
  let w = Math.min(width, right - left + 1 + padding * 2), h = Math.min(height, bottom - top + 1 + padding * 2);
  if (w / h < aspect) w = Math.min(width, Math.ceil(h * aspect));
  else h = Math.min(height, Math.ceil(w / aspect));
  return { x: Math.max(0, Math.min(width - w, Math.round((left + right + 1 - w) / 2))),
    y: Math.max(0, Math.min(height - h, Math.round((top + bottom + 1 - h) / 2))), width: w, height: h };
}
