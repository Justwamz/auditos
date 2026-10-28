/** Words that sound like software. Nothing a person reads may contain them. */
export const BANNED_WORDS: RegExp[] = [
  /authenticator/i,
  /outbox/i,
  /simulat\w*/i,
  /session/i,
  /csrf/i,
  /malware/i,
  /quarantin\w*/i,
  /fingerprint/i,
  /sha-?256/i,
  /tenant/i,
  /token/i,
  /payload/i,
  /\bapi\b/i,
  /\bmfa\b/i,
  /\btotp\b/i,
];

/** The distinct banned words found in the text, lowercased, in the order first found. */
export function findJargon(text: string): string[] {
  const found = new Set<string>();
  for (const re of BANNED_WORDS) {
    const g = new RegExp(re.source, 'gi');
    for (const m of text.matchAll(g)) found.add(m[0].toLowerCase());
  }
  return [...found];
}
