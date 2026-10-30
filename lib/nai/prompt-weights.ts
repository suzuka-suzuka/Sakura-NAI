import type { GenerationSettings } from "./types";

/**
 * Separate a numeric tag suffix from a closing weight delimiter. NovelAI reads
 * `bm94199::` as a new weight, even inside `1.04::artist:bm94199::`.
 * Only repair an already-open numeric scope; genuine weight openings at token
 * boundaries remain untouched. Quoted text and manual Text: blocks are literal.
 */
export function normalizePromptWeights(prompt: string): string {
  let active = false;
  let quote = "";
  let copied = 0;
  let result = "";
  const manualText = /(?:^|[\n,])\s*text\s*:/i.exec(prompt);
  const end = manualText?.index ?? prompt.length;
  for (let i = 0; i < end; i++) {
    const char = prompt[i];
    if (char === "\\") { i++; continue; }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "「") { quote = char === "「" ? "」" : '"'; continue; }
    if (char !== ":" || prompt[i + 1] !== ":") continue;

    // Inspect only the immediately adjacent number, as the official editor does.
    let start = i;
    while (start > 0 && /[\d.-]/.test(prompt[start - 1])) start--;
    const suffix = prompt.slice(start, i);
    const number = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(suffix);
    const boundary = start === 0 || /[\s,{\[]/.test(prompt[start - 1]) || prompt.slice(start - 2, start) === "::";
    if (number && boundary) {
      active = true;
    } else {
      if (active && /[\d.-]/.test(prompt[i - 1] ?? "")) {
        result += prompt.slice(copied, i) + " ";
        copied = i;
      }
      active = false;
    }
    i++;
  }
  return copied ? result + prompt.slice(copied) : prompt;
}

/** Normalize the wire copy, leaving the user's editor settings untouched. */
export function normalizePromptSettings(s: GenerationSettings): GenerationSettings {
  return {
    ...s,
    prompt: normalizePromptWeights(s.prompt),
    negativePrompt: normalizePromptWeights(s.negativePrompt),
    characters: s.characters.map(c => ({ ...c, prompt: normalizePromptWeights(c.prompt), uc: normalizePromptWeights(c.uc) })),
  };
}
