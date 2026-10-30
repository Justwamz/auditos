'use client';
import { useEffect, useState } from 'react';

/** The width at which the side menu becomes a drawer. Keep in step with the `max-width: 52rem` rules in globals.css. */
export const PHONE_QUERY = '(max-width: 52rem)';

/** Whether a media query matches. False on the server and on the first render; follows changes afterwards. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
