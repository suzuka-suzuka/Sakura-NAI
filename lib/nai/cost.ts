import { isV4Model, isV5Model } from "./models";
import { Model } from "./protocol";
import type { GenerationSettings } from "./types";

export type AccountInfo = { tier: number; active: boolean; expiresAt?: number; accountType?: number; anlas: number | null; usage: { percent: number; isNegative: boolean } | null };
export function parseAccount(value: unknown): AccountInfo {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v.tier !== "number" || typeof v.active !== "boolean") throw new Error("Invalid subscription response");
  const credits = v.trainingStepsLeft as Record<string, unknown> | undefined;
  const usage = v.usage as Record<string, unknown> | undefined;
  return {
    tier: v.tier, active: v.active,
    expiresAt: typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt) ? v.expiresAt : undefined,
    accountType: typeof v.accountType === "number" ? v.accountType : undefined,
    anlas: typeof credits?.fixedTrainingStepsLeft === "number" && typeof credits?.purchasedTrainingSteps === "number" ? credits.fixedTrainingStepsLeft + credits.purchasedTrainingSteps : null,
    usage: typeof usage?.percent === "number" && typeof usage.isNegative === "boolean"
      ? { percent: Math.max(0, Math.min(100, usage.percent)), isNegative: usage.isNegative } : null,
  };
}

export type CostEstimate = { total: number; base: number; references: number; encoding: number; accountKnown: boolean; usesAllowance: boolean; valid: boolean };
/** Current dedicated V5 2x upscaler; the input pixel count selects the price tier. */
export function upscaleCost(width: number, height: number): number | null {
  const area=width*height;
  if (!Number.isFinite(area) || area<=0 || area>3145728) return null;
  return area<=1048576 ? 1 : area<=1747627 ? 2 : area<=2446678 ? 3 : 4;
}
export function augmentCost(width: number, height: number, backgroundRemoval: boolean, account: AccountInfo | null) {
  const area = Math.max(1048576, Math.min(3145728, width * height));
  const base = Math.max(2, Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * 28));
  const active = !!account && ([1,2,3,4].includes(account.accountType ?? 0) || (account.expiresAt !== undefined ? account.expiresAt > Date.now()/1000 : account.active));
  return backgroundRemoval ? base * 3 + 5 : active && account?.tier === 3 && area <= 1048576 ? 0 : base;
}
/** Mirrors Aaalice_NAI_Launcher's modern Anlas calculation; see THIRD_PARTY_NOTICES.md.
 * The V5 multiplier is applied AFTER rounding the area/step base, then rounded once more.
 * Opus waives one image's base charge per eligible request, never the entire batch.
 * V5 uses isNegative (not the rounded display percentage) to determine exhausted allowance.
 * Unknown accounts never display a free price. Final billing remains server-controlled.
 */
export function estimateCost(s: GenerationSettings, account: AccountInfo | null, uncachedVibes = 0): CostEstimate {
  const v5 = isV5Model(s.model);
  const active = !!account && ([1, 2, 3, 4].includes(account.accountType ?? 0) ||
    (account.expiresAt !== undefined ? account.expiresAt > Date.now() / 1000 : account.active));
  const opus = active && account?.tier === 3;
  const allowance = !v5 || !!(account?.usage && !account.usage.isNegative);
  const free = opus && allowance && s.width * s.height <= 1048576 && s.steps <= 28;
  const area = s.width * s.height;
  const smea = !s.imageSource && !v5 && !isV4Model(s.model) && s.autoSmea;
  const strength = s.imageSource ? s.imageSource.mode === "infill" ? s.imageSource.inpaintStrength : s.imageSource.strength : 1;
  const perImage = Math.max(2, Math.ceil(Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * s.steps) * (smea ? 1.2 : 1) * (v5 ? 1.5 : 1) * strength));
  const base = perImage * Math.max(0, s.nSamples - (free ? 1 : 0));
  const refsAllowed = !v5 && s.imageSource?.mode !== "infill";
  const director = refsAllowed && (s.model === Model.V4_5 || s.model === Model.V4_5_CUR) ? s.directorReference.length : 0;
  const references = !refsAllowed ? 0 : director ? director * 5 * s.nSamples : isV4Model(s.model) ? Math.max(0, s.vibe.length - 4) * 2 : 0;
  const encoding = refsAllowed && !director && isV4Model(s.model) ? uncachedVibes * 2 : 0;
  return { total: base + references + encoding, base, references, encoding, usesAllowance: !!(free && v5), accountKnown: !!account, valid: perImage <= 140 };
}

export type GenerationPreferences = { streamPreview: boolean; confirmPaid: boolean };
export const DEFAULT_PREFERENCES: GenerationPreferences = { streamPreview: true, confirmPaid: true };
export function loadGenerationPreferences(): GenerationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem("nya-generation-preferences") || "{}");
    return { streamPreview: typeof value.streamPreview === "boolean" ? value.streamPreview : true, confirmPaid: typeof value.confirmPaid === "boolean" ? value.confirmPaid : true };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}
export function saveGenerationPreferences(p: GenerationPreferences) {
  try { localStorage.setItem("nya-generation-preferences", JSON.stringify(p)); } catch { /* Preferences must not interrupt generation. */ }
}
