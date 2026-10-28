export const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function isShown(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  return el.offsetParent !== null || el === document.activeElement;
}

/** Focusable elements inside root that are really on screen (not hidden, collapsed or visibility:hidden). */
export function visibleFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isShown);
}

/**
 * Where Tab should go to keep focus inside a dialog: the element to focus, or null when the browser may move normally.
 * `items` are the visible focusable elements in order; `container` counts as "before the first" (it holds focus on open).
 */
export function trapTarget<T>(items: T[], active: T | null, container: T | null, shift: boolean): T | null {
  if (items.length === 0) return null;
  const head = items[0]!;
  const tail = items[items.length - 1]!;
  if (shift && (active === head || active === container || active === null || !items.includes(active))) return tail;
  if (!shift && (active === tail || active === null || !items.includes(active))) return head;
  return null;
}
