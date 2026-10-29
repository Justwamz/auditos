import { accentIsDerived, derivePalette } from '@auditos/brand';

export const ACCENT_FOLLOWS_NOTE = 'Using a light shade of your main colour until you pick your own.';
export const BRANDING_POINTER = 'The logo, colours and contact details on your invoices are set by the firm administrator on the Branding page.';

/** What the accent picker shows: the light shade made from the main colour while the accent is still the standard one. */
export function accentView(primary: string, secondary: string): { shown: string; derived: boolean; note: string | null } {
  if (accentIsDerived(primary, secondary)) {
    return { shown: derivePalette({ primary, secondary }).palette['--accent'], derived: true, note: ACCENT_FOLLOWS_NOTE };
  }
  return { shown: secondary, derived: false, note: null };
}
