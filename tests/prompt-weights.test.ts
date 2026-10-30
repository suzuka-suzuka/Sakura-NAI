import test from "node:test";
import assert from "node:assert/strict";
import { normalizePromptWeights } from "../lib/nai/prompt-weights";
import { buildPayload } from "../lib/nai/payload";
import { buildV5Payload } from "../lib/nai/v5";
import { DEFAULT_SETTINGS } from "../lib/nai/types";
import { Model } from "../lib/nai/protocol";
import { V5_FULL, V5_FULL_MEDIUM } from "../lib/nai/models";

test("numeric tag endings close the intended weight instead of opening a huge weight", () => {
  for (const [input, expected] of [
    ["1.04::artist:bm94199::, year 2026", "1.04::artist:bm94199 ::, year 2026"],
    ["1.05::year_2025::, other_tags", "1.05::year_2025 ::, other_tags"],
    ["1.2::a1::, 0.8::b2::, {1.1::...::}, 1.3::-_-::", "1.2::a1 ::, 0.8::b2 ::, {1.1::... ::}, 1.3::-_- ::"],
    ["0.9::1.05::artist:bm94199::::", "0.9::1.05::artist:bm94199 ::::"],
  ]) {
    assert.equal(normalizePromptWeights(input), expected);
    assert.equal(normalizePromptWeights(expected), expected, "normalization is idempotent");
  }
});

test("real openings, already safe closings and literal text are preserved", () => {
  for (const input of [
    "artist:bm94199", "artist:bm94199::", "year_2025::, foo",
    "1.05::cat, 2::dog::", "1.05::cat,2::dog::", "0.9::1.05::iu::::",
    "-2::blurry::, 0::text::, .5::cat::", "1.04::artist:bm94199 ::",
    "1.04::artist:bm94199, ::", "1.04::artist:bm94199",
    'sign "1.04::artist:bm94199::"', "sign 「1.04::artist:bm94199::」",
    "cat, Text: 1.04::artist:bm94199::",
    "cat\nText: 1.04::artist:bm94199::",
  ]) assert.equal(normalizePromptWeights(input), input);
});

test("V4+ wire captions normalize all prompt channels without mutating editor settings", () => {
  for (const model of [Model.V4, Model.V4_5, V5_FULL] as const) {
    const s = { ...DEFAULT_SETTINGS, model, qualityToggle: false, ucPreset: 3 as const, autoText: false,
      prompt: "1.04::artist:bm94199::", negativePrompt: "1.2::artist:foo123::",
      characters: [{ prompt: "1.1::character42::", uc: "0.8::outfit99::", enabled: true, center: { x: 0.5, y: 0.5 } }] };
    const before = structuredClone(s);
    const p = buildPayload(s, 123);
    assert.equal(p.input, "1.04::artist:bm94199 ::");
    assert.equal(p.parameters.negative_prompt, "1.2::artist:foo123 ::");
    const positive = p.parameters.v4_prompt as { caption: { base_caption: string; char_captions: { char_caption: string }[] } };
    const negative = p.parameters.v4_negative_prompt as typeof positive;
    assert.equal(positive.caption.base_caption, p.input);
    assert.equal(negative.caption.base_caption, p.parameters.negative_prompt);
    assert.equal(positive.caption.char_captions[0].char_caption, "1.1::character42 ::");
    assert.equal(negative.caption.char_captions[0].char_caption, "0.8::outfit99 ::");
    if (model === V5_FULL) assert.deepEqual(buildV5Payload(s, 123), p);
    assert.deepEqual(s, before);
  }
});

test("V3 stays verbatim; V5 Medium still discards custom negative prompts", () => {
  const s = { ...DEFAULT_SETTINGS, prompt: "1.04::artist:bm94199::", negativePrompt: "1.2::foo123::", qualityToggle: false };
  assert.equal(buildPayload({ ...s, model: Model.V3 }, 1).input, s.prompt);
  const medium = buildPayload({ ...s, model: V5_FULL_MEDIUM }, 1);
  assert.equal(medium.input, "1.04::artist:bm94199 ::");
  assert.ok(!String(medium.parameters.negative_prompt).includes("foo123"));
});
