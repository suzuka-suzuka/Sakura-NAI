/** Fit all samples inside the actual canvas while retaining their requested pixel aspect. */
export function fitPreviewGrid(width: number, height: number, count: number, availableWidth: number, availableHeight: number, gap = 12) {
  let best = { columns: 1, width: 0, height: 0, tileWidth: 0, tileHeight: 0 };
  if (Math.min(width, height, count, availableWidth, availableHeight) <= 0) return best;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const scale = Math.max(0, Math.min((availableWidth - gap * (columns - 1)) / (columns * width), (availableHeight - gap * (rows - 1)) / (rows * height), 1));
    const tileWidth = width * scale, tileHeight = height * scale;
    if (tileWidth > best.tileWidth) best = { columns, tileWidth, tileHeight, width: tileWidth * columns + gap * (columns - 1), height: tileHeight * rows + gap * (rows - 1) };
  }
  return best;
}
