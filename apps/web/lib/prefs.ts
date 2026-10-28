'use client';

import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'aos:';

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Reads a saved preference. Any storage or JSON problem gives the fallback. */
export function readPref<T>(key: string, fallback: T, storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): T {
  try {
    if (!storage) return fallback;
    const text = storage.getItem(PREFIX + key);
    if (text === null || text === undefined) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Saves a preference. Never throws: a blocked or full store just means it is not remembered. */
export function writePref(key: string, value: unknown, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
  try {
    storage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* not remembered; nothing to do */
  }
}

/** A saved preference as state. Starts at the fallback so server and client markup match, then reads storage after mount. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    setValue(readPref(key, fallback));
    // fallback is the initial value only; re-reading on every new object would loop
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      writePref(key, v);
    },
    [key],
  );
  return [value, set];
}
