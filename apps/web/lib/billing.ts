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
