import { isV5Model, supportsPreciseReference } from "./models";
import type { GenerationSettings, ReferenceImage } from "./types";

export function activePreciseReferences(s: GenerationSettings) {
  if (s.imageSource?.mode === "infill" || !supportsPreciseReference(s.model)) return [];
  return isV5Model(s.model) ? s.directorReference : s.directorReference.filter(ref => ref.referenceType !== "costume");
}

export function prefersSameOutfit(ref: ReferenceImage) {
  return ref.preferSameOutfit ?? (ref.referenceType ?? "character&style") === "character&style";
}

export function preciseReferenceCaption(ref: ReferenceImage, v5: boolean) {
  const type = ref.referenceType ?? "character&style";
  if (v5 && type === "character" && prefersSameOutfit(ref)) return "character_mainoutfit";
  if (v5 && type === "character&style" && !prefersSameOutfit(ref)) return "character&style_anyoutfit";
  return type;
}
