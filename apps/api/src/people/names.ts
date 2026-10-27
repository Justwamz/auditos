/** Words that mark a shared or role mailbox. A person's address is made of other words. */
const GENERIC = new Set([
  'admin', 'administrator', 'info', 'accounts', 'account', 'accounting', 'office', 'support', 'finance', 'hr', 'audit', 'noreply',
  'no', 'reply', 'team', 'sales', 'firm', 'contact', 'hello', 'mail', 'general', 'enquiries', 'inquiries', 'billing', 'payroll',
  'reception', 'secretary', 'staff', 'user', 'users', 'partner', 'manager', 'service', 'services', 'helpdesk', 'it',
]);

/** True when the address looks like a shared or role mailbox (admin@, info@, accounts@, firm-admin@, ...). */
export function isGenericMailbox(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const tokens = local.split(/[._+-]+/).filter(Boolean);
  return tokens.length === 0 || tokens.every((t) => GENERIC.has(t));
}

const WORD = /^[\p{L}][\p{L}'.-]*$/u;

/** A person's name: at least two words of two or more characters, letters with hyphens and apostrophes only. */
export function isPersonName(name: string): boolean {
  const t = name.trim();
  if (t.length < 4 || t.length > 120) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.every((w) => w.length >= 2 && WORD.test(w));
}
