/**
 * The text of a kept email as a person should read it. The system adds a closing line about how delivery works;
 * the page already says "Not actually sent (practice mode)", so that line is left out.
 */
export function mailText(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/delivery is simulated|kept in the outbox|not actually sent/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether a row matches what was typed in a search box (every word must be found somewhere in the row's text). */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
