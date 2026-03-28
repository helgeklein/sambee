import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";

interface CachedAsyncDataEntry<T> {
  data?: T;
  promise?: Promise<T>;
}

const cachedAsyncDataStore = new Map<string, CachedAsyncDataEntry<unknown>>();

function getCachedEntry<T>(cacheKey: string): CachedAsyncDataEntry<T> | undefined {
  return cachedAsyncDataStore.get(cacheKey) as CachedAsyncDataEntry<T> | undefined;
}

export function getCachedAsyncData<T>(cacheKey: string): T | null {
  const entry = getCachedEntry<T>(cacheKey);
  return entry?.data ?? null;
}

export function clearCachedAsyncData(cacheKey?: string) {
  if (cacheKey) {
    cachedAsyncDataStore.delete(cacheKey);
    return;
  }

  cachedAsyncDataStore.clear();
}

export async function primeCachedAsyncData<T>(cacheKey: string, load: () => Promise<T>, force = false): Promise<T> {
  const existingEntry = getCachedEntry<T>(cacheKey);

  if (!force && existingEntry?.data !== undefined) {
    return existingEntry.data;
  }

  if (existingEntry?.promise) {
    return existingEntry.promise;
  }

  const previousData = existingEntry?.data;
  const promise = Promise.resolve()
    .then(load)
    .then(
      (result) => {
        cachedAsyncDataStore.set(cacheKey, { data: result });
        return result;
      },
      (error) => {
        if (previousData !== undefined) {
          cachedAsyncDataStore.set(cacheKey, { data: previousData });
        } else {
          cachedAsyncDataStore.delete(cacheKey);
        }

        throw error;
      }
    );

  cachedAsyncDataStore.set(cacheKey, previousData !== undefined ? { data: previousData, promise } : { promise });

  return promise;
}

interface UseCachedAsyncDataOptions<T> {
  cacheKey: string;
  load: () => Promise<T>;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  retainDataOnError?: boolean;
}

interface UseCachedAsyncDataResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  hasResolved: boolean;
  refresh: (forceForeground?: boolean) => Promise<T | null>;
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useCachedAsyncData<T>({
  cacheKey,
  load,
  enabled = true,
  onError,
  retainDataOnError = true,
}: UseCachedAsyncDataOptions<T>): UseCachedAsyncDataResult<T> {
  const [data, setDataState] = useState<T | null>(() => getCachedAsyncData<T>(cacheKey));
  const [loading, setLoading] = useState(() => enabled && getCachedAsyncData<T>(cacheKey) === null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasResolved, setHasResolved] = useState(() => getCachedAsyncData<T>(cacheKey) !== null);
  const mountedRef = useRef(true);
  const dataRef = useRef<T | null>(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>(
    (nextValue) => {
      setDataState((previousValue) => {
        const resolvedValue = typeof nextValue === "function" ? (nextValue as (value: T | null) => T | null)(previousValue) : nextValue;

        if (resolvedValue === null) {
          cachedAsyncDataStore.delete(cacheKey);
        } else {
          cachedAsyncDataStore.set(cacheKey, { data: resolvedValue });
        }

        return resolvedValue;
      });

      setHasResolved(true);
      setLoading(false);
      setRefreshing(false);
    },
    [cacheKey]
  );

  const refresh = useCallback(
    async (forceForeground = false) => {
      if (!enabled) {
        return dataRef.current;
      }

      const cachedData = getCachedAsyncData<T>(cacheKey);
      const hasCachedData = cachedData !== null || dataRef.current !== null;

      if (cachedData !== null && dataRef.current === null && mountedRef.current) {
        setDataState(cachedData);
      }

      if (!hasCachedData || forceForeground) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const nextData = await primeCachedAsyncData(cacheKey, load, true);

        if (mountedRef.current) {
          setDataState(nextData);
          setHasResolved(true);
        }

        return nextData;
      } catch (error) {
        if (mountedRef.current) {
          setHasResolved(true);

          if (!retainDataOnError && !hasCachedData) {
            setDataState(null);
          }
        }

        onError?.(error);
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [cacheKey, enabled, load, onError, retainDataOnError]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const cachedData = getCachedAsyncData<T>(cacheKey);

    if (cachedData !== null) {
      setDataState(cachedData);
      setHasResolved(true);
      setLoading(false);
      void refresh();
      return;
    }

    setDataState(null);
    setHasResolved(false);
    setLoading(true);
    void refresh(true);
  }, [cacheKey, enabled, refresh]);

  return {
    data,
    loading,
    refreshing,
    hasResolved,
    refresh,
    setData,
  };
}
