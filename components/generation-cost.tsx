"use client";
import { useStore } from "@/lib/store";
import { estimateCost } from "@/lib/nai/cost";
import { translateUI, useLocale } from "@/lib/i18n";

export function useGenerationCost() {
  const settings = useStore(s => s.settings);
  const account = useStore(s => s.account);
  const client = useStore(s => s.client);
  return estimateCost(settings, account, client?.uncachedVibes(settings) ?? settings.vibe.length);
}
export function GenerationCost() {
  useLocale();
  const cost = useGenerationCost();
  return <span data-testid="generation-cost" className="whitespace-nowrap text-[12px] font-medium tabular-nums"
    title={translateUI(cost.accountKnown ? "Estimated Anlas cost for the whole batch. Final billing is determined by NovelAI." : "Subscription status unavailable; showing the estimate without a free allowance.")}>
    {!cost.valid ? translateUI("Over cost limit") : translateUI("{0} points", cost.total)}
  </span>;
}
