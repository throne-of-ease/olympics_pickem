import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for polling data at regular intervals
 * @param {Function} fetchFn - Function to call for fetching data
 * @param {number} interval - Polling interval in milliseconds
 * @param {boolean} enabled - Whether polling is enabled
 */
export function usePolling(fetchFn, interval = 60000, enabled = true) {
  const savedCallback = useRef(fetchFn);
  const intervalRef = useRef(null);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = fetchFn;
  }, [fetchFn]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      savedCallback.current?.();
    }, interval);
  }, [interval]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [enabled, startPolling, stopPolling]);

  return { startPolling, stopPolling };
}

export default usePolling;
