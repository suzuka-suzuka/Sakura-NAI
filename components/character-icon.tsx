import { Mars, UserRound, Venus } from "lucide-react";
import { characterKind, type CharacterKind } from "@/lib/nai/characters";

export function CharacterIcon({ prompt = "", kind, className }: { prompt?: string; kind?: CharacterKind; className?: string }) {
  const value = kind ?? characterKind(prompt);
  const Icon = value === "female" ? Venus : value === "male" ? Mars : UserRound;
  return <Icon className={className} aria-hidden />;
}
