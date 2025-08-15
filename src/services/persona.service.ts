// src/services/persona.service.ts
// TL;DRabbit persona reply builder (local, deterministic)

function stripUrlsMentionsHashes(input: string) {
  return input
    .replace(/https?:\/\/\S+/gi, "") // URLs
    .replace(/@[A-Za-z0-9_]+/g, "")  // mentions
    .replace(/#[^\s]+/g, "")         // hashtags
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

export function craftTLDRabbitReply(sourceText: string): string {
  const clean = stripUrlsMentionsHashes(sourceText);

  // TL;DR (≤140 chars including prefix)
  const tldrPrefix = "TL;DR: ";
  const tldr = tldrPrefix + clamp(clean, 140 - tldrPrefix.length);

  // Zinger (≤100 chars including prefix)
  const zPrefix = "Zinger: ";
  // Lightly witty, kind, no links/hashtags
  const wittyCandidates = [
    "Hop to the signal, not the noise.",
    "Ears up — watching the tape.",
    "Bunny math: risk small, learn fast.",
    "We nibble facts, not hopium.",
    "Cautious paws, quick moves.",
  ];
  const pick = wittyCandidates[Math.floor(Math.random() * wittyCandidates.length)];
  const zinger = zPrefix + clamp(pick, 100 - zPrefix.length);

  return `${tldr}\n${zinger}`;
}
