import { isMediumModel } from "./models";
import { Sampler } from "./protocol";
import type { GenerationSettings } from "./types";

/** Fixed wire settings; leave the editable High settings intact when switching effort. */
export function effectiveEffortSettings(s: GenerationSettings): GenerationSettings {
  return isMediumModel(s.model) ? { ...s, steps: 14, sampler: Sampler.EULER_ANC,
    cfgRescale: 0, ucPreset: 0, negativePrompt: "",
    characters: s.characters.map(c => ({ ...c, uc: "" })) } : s;
}
