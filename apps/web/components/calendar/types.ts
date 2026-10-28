export interface CalEvent {
  id: string; title: string; kind: string; startsAt: string; endsAt: string; allDay: boolean; location: string | null; notes: string | null;
  clientId: string | null; clientName: string | null; engagementId: string | null; attendees: { id: string; name: string }[];
  createdBy: string; createdByName: string; mine: boolean;
}
export interface Milestone { date: string; title: string; engagementId: string; kind: string }
export interface Person { id: string; fullName: string | null; email: string; role: string }

const PALETTE = ['#2e6b4c', '#1d5f8a', '#a8641a', '#7b3f8c', '#b42318', '#3b7f87', '#6b7a1f', '#8a4a5c'];

/** A steady colour for a person, so the same person has the same dot everywhere. */
export function personColour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
