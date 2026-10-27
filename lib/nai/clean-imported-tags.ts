/** Clean separators only; retain repeated tags, quoted text and weighted groups verbatim. */
export function cleanImportedTags(value: string): string {
  const tags: string[] = [];
  const brackets: string[] = [];
  let start = 0, quoted = false, weighted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if ("([{".includes(char)) brackets.push(char);
    else if (")]}".includes(char)) {
      const opening = { ")": "(", "]": "[", "}": "{" }[char as ")" | "]" | "}"];
      if (brackets.at(-1) === opening) brackets.pop();
    } else if (char === ":" && value[i + 1] === ":") { weighted = !weighted; i++; }
    else if (char === "," && !brackets.length && !weighted) {
      const tag = value.slice(start, i).trim();
      if (tag) tags.push(tag);
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) tags.push(last);
  return tags.join(", ");
}
