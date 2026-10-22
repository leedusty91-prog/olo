/** Split an olo reply into chat bubbles: "||" separators, else blank lines; at most 4. */
export const MAX_BUBBLES = 4;

export function splitBubbles(text: string, max = MAX_BUBBLES): string[] {
  const raw = text.includes("||") ? text.split(/\s*\|\|\s*/) : text.split(/\n\s*\n/);
  const parts = raw.map((p) => p.trim()).filter(Boolean);
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n")];
}

/** Bubbles that are already complete while a reply is still streaming. */
export function completedBubbles(partial: string): string[] {
  const parts = splitBubbles(partial, Number.MAX_SAFE_INTEGER);
  const open = !/(\|\||\n\s*\n)\s*$/.test(partial);
  return (open ? parts.slice(0, -1) : parts).slice(0, MAX_BUBBLES - 1);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
