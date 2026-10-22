import { useCallback, useEffect, useRef, useState } from "react";

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  /** True only while there is no data yet (refetches keep showing previous data). */
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/**
 * Minimal data-fetching hook. `key` identifies the request: when it changes the data is refetched.
 * Stale responses are ignored and previous data stays visible during refetches (no skeleton flash).
 */
export function useQuery<T>(fetcher: () => Promise<T>, key: string): QueryState<T> {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: unknown }>({ key: null, data: undefined, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const fetchFor = useCallback(async (forKey: string) => {
    const gen = ++generation.current;
    try {
      const data = await fetcherRef.current();
      if (gen === generation.current) setState({ key: forKey, data, error: null });
    } catch (error) {
      if (gen === generation.current) setState((s) => ({ key: forKey, data: s.data, error }));
    }
  }, []);

  useEffect(() => {
    void fetchFor(key);
  }, [key, fetchFor]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchFor(key);
    } finally {
      setRefreshing(false);
    }
  }, [key, fetchFor]);

  const error = state.error;
  return {
    data: state.data,
    error,
    loading: state.data === undefined && error == null,
    refreshing: refreshing || (state.key !== null && state.key !== key),
    reload,
  };
}
