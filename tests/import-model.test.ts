import test from "node:test";
import assert from "node:assert/strict";
import { recipeFromNovelAIMetadata } from "../lib/nai/import-recipe";
import { buildPayload } from "../lib/nai/payload";
import { Model } from "../lib/nai/protocol";
import { vibeEncoding } from "../lib/nai/vibes";

function recipe(source: string, extra = {}) {
  return recipeFromNovelAIMetadata([
    { keyword: "Source", text: source },
    { keyword: "Comment", text: JSON.stringify({
      prompt: "rating:general, best quality, very aesthetic, absurdres",
      seed: 1629524086, reference_image_multiple: ["AQID", "BAUG", "BwgJ"],
      reference_strength_multiple: [0.16083916083916086, 0.4195804195804196, 0.4195804195804196],
      reference_information_extracted_multiple: [], ...extra,
    }) },
  ], { width: 1024, height: 1024 });
}

test("official V4 Curated source imports its original model and encoded Vibes", () => {
  const { settings, omittedReferences } = recipe("NovelAI Diffusion V4 7ABFFA2A");
  assert.equal(settings.model, Model.V4_CUR);
  assert.equal(buildPayload(settings, settings.seed).model, "nai-diffusion-4-curated-preview");
  assert.equal(settings.seed, 1629524086);
  assert.equal(omittedReferences, false);
  assert.deepEqual(settings.vibe.map(ref => ref.sourceModel), Array(3).fill(Model.V4_CUR));
  assert.deepEqual(settings.vibe.map(ref => vibeEncoding(ref, Model.V4_CUR)?.data), ["AQID", "BAUG", "BwgJ"]);
  assert.deepEqual(settings.vibe.map(ref => ref.strength), [0.16083916083916086, 0.4195804195804196, 0.4195804195804196]);
});

test("official hash aliases distinguish Full, Curated and early V4.5 labels", () => {
  for (const hash of ["7ABFFA2A", "C1CCBA86", "770A9E12"]) assert.equal(recipe(`NovelAI Diffusion V4 ${hash}`).settings.model, Model.V4_CUR);
  for (const hash of ["37442FCA", "4F49EC75", "CA4B7203", "79F47848", "F6302A9D"]) assert.equal(recipe(`NovelAI Diffusion V4 ${hash}`).settings.model, Model.V4);
  for (const hash of ["C02D4F98", "5AB81C7C", "B5A2A797"]) assert.equal(recipe(`NovelAI Diffusion V4.5 ${hash}`).settings.model, Model.V4_5_CUR);
  for (const hash of ["5AB81C7C", "B5A2A797"]) assert.equal(recipe(`NovelAI Diffusion V4 ${hash}`).settings.model, Model.V4_5_CUR);
  for (const hash of ["4BDE2A90", "1229B44F", "B9F340FD", "F3D95188"]) assert.equal(recipe(`NovelAI Diffusion V4.5 ${hash}`).settings.model, Model.V4_5);
  assert.equal(recipe("novelai diffusion v4 7abffa2a").settings.model, Model.V4_CUR);
});

test("explicit API model takes precedence and unknown sources retain family fallback", () => {
  assert.equal(recipe("NovelAI Diffusion V4 7ABFFA2A", { model: Model.V4 }).settings.model, Model.V4);
  assert.equal(recipe("NovelAI Diffusion V4 DEADBEEF").settings.model, Model.V4);
  assert.equal(recipe("NovelAI Diffusion V4 Curated").settings.model, Model.V4_CUR);
});
