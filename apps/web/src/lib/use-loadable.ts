import { useEffect, useState } from "react";
import { api } from "./api";

export function items<T>(res: unknown): T[] {
  return Array.isArray(res) ? res : (res as { items?: T[] })?.items ?? [];
}

export function useLoadable<T>(path: string, fallback: T, extract: (res: unknown) => T) {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>(path).then(
      (res) => {
        if (!cancelled) setData(extract(res));
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Ошибка загрузки");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, tick, extract]);

  return { data, error, reload: () => setTick((n) => n + 1), setData };
}
