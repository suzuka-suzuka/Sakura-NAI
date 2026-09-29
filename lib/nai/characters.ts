export type CharacterKind = "female" | "male" | "other";

export const CHARACTER_STARTERS: Record<CharacterKind, string> = { female: "girl, ", male: "boy, ", other: "" };

/** The official picker seeds the prompt; the badge follows the prompt rather than a hidden API field. */
export function characterKind(prompt: string): CharacterKind {
  const female = /\b(?:\d*girls?|women|woman|female)\b/i.test(prompt);
  const male = /\b(?:\d*boys?|men|man|male)\b/i.test(prompt);
  return female === male ? "other" : female ? "female" : "male";
}
