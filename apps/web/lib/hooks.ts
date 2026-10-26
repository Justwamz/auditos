'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface Loaded<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Loads a GET endpoint. Pass null to skip. Re-runs when the path changes or reload() is called. */
export function useApi<T = Record<string, unknown>>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const mine = ++seq.current;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (mine === seq.current) {
          setData(d);
          setError(undefined);
        }
      })
      .catch((e) => {
        if (mine === seq.current) setError(e);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
