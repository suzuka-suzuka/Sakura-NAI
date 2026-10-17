/** Generation is limited by area, not a 2048px edge (official client, 2026-10-17). */
export const DIMENSION_STEP = 64;
export const MAX_GENERATION_PIXELS = 3_145_728;
export const MAX_GENERATION_DIMENSION = MAX_GENERATION_PIXELS / DIMENSION_STEP;

export const isGenerationDimension = (value: number) =>
  Number.isInteger(value) && value >= DIMENSION_STEP && value <= MAX_GENERATION_DIMENSION && value % DIMENSION_STEP === 0;

export const isGenerationSize = (width: number, height: number) =>
  isGenerationDimension(width) && isGenerationDimension(height) && width * height <= MAX_GENERATION_PIXELS;

export const snapGenerationDimension = (value: number) =>
  Math.max(DIMENSION_STEP, Math.min(MAX_GENERATION_DIMENSION, Math.round(value / DIMENSION_STEP) * DIMENSION_STEP));
