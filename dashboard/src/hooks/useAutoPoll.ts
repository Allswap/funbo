import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAutoPollOptions {
  /** Auto-poll interval in milliseconds. Default: 30000 */
  interval?: number;
  /** Start polling immediately on mount. Default: false */
  autoStart?: boolean;
  /** Label shown in the button/tooltip. Default: 'Auto' */
  label?: string;
}

export interface UseAutoPollResult {
  /** Last refresh status */
  loading: boolean;
  /** Whether auto-poll is currently active */
  isPolling: boolean;
  /** Manually trigger a poll */
  refetch: () => void;
  /** Toggle auto-poll on/off */
  togglePolling: () => void;
  /** Set auto-poll to a specific state */
  setPolling: (v: boolean) => void;
}

/**
 * Shared auto-poll primitive for dashboard tabs.
 *
 * Replaces per-tab `useEffect(fetch)` loops with one consistent:
 * - Manual Refresh button
 * - Auto toggle (defaults to OFF per tab, lets the operator decide)
 * - Cleanup on unmount
 *
 * Usage:
 *   const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchNetworks, { interval: 30000 });
 */
export function useAutoPoll(
  callback: () => void | Promise<void>,
  opts: UseAutoPollOptions = {},
): UseAutoPollResult {
  const { interval = 30000, autoStart = false } = opts;

  const [loading, setLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(autoStart);
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep the latest callback to avoid stale closures
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      await callbackRef.current();
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch once on mount (match existing behaviour)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await run();
    })();
    return () => {
      cancelled = true;
    };
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll loop
  useEffect(() => {
    if (!isPolling) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      run();
    }, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPolling, interval, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePolling = useCallback(() => setIsPolling((p) => !p), []);
  const setPolling = useCallback((v: boolean) => setIsPolling(v), []);

  return { loading, isPolling, refetch: run, togglePolling, setPolling };
}

/** Preset for "heavy" tables that shouldn't poll more than once per minute. */
export const POLL_HEAVY: UseAutoPollOptions = { interval: 60000, autoStart: false };

/** Preset for lightweight health/metrics endpoints. */
export const POLL_FAST: UseAutoPollOptions = { interval: 15000, autoStart: false };
