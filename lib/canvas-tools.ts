/** Exact contiguous fill with a bounded stack. Works on transparent layers as well. */
export function floodFill(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, rgba: readonly number[]) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  const old = Array.from(data.subarray(offset, offset + 4));
  if (old.every((v, i) => v === rgba[i])) return;
  const queue = new Int32Array(width * height), seen = new Uint8Array(width * height);
  let head = 0, tail = 1; queue[0] = y * width + x; seen[queue[0]] = 1;
  while (head < tail) {
    const p = queue[head++], o = p * 4;
    if (!old.every((v, i) => data[o + i] === v)) continue;
    for (let i = 0; i < 4; i++) data[o + i] = rgba[i];
    const neighbors = [p - width, p + width, p % width ? p - 1 : -1, p % width < width - 1 ? p + 1 : -1];
    for (const n of neighbors) if (n >= 0 && n < width * height && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
  }
}

/** Save brush coverage as opaque grayscale; binarize only when preparing the API request. */
export function opaqueMask(data: Uint8ClampedArray) {
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) { const value = data[i + 3]; result[i] = result[i + 1] = result[i + 2] = value; result[i + 3] = 255; }
  return result;
}
