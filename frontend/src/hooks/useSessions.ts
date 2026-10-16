import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startsAtMs, sortChronologically } from '../lib/format';
import { fetchSessions } from '../services/api';
import type { Session, SessionFilters } from '../types/session';

export const REFRESH_INTERVAL_MS = 60_000;
/** Re-evaluate "already started" between fetches so cards drop off on time. */
const CLOCK_TICK_MS = 15_000;

type Status = 'loading' | 'success' | 'error';

interface State {
  sessions: Session[];
  status: Status;
  error: string | null;
  /** True when a background refresh failed but older data is still shown. */
  stale: boolean;
  lastUpdated: number | null;
  /** serverTime − local clock, so filtering does not trust a wrong device clock. */
  clockOffsetMs: number;
}

const INITIAL_STATE: State = {
  sessions: [],
  status: 'loading',
  error: null,
  stale: false,
  lastUpdated: null,
  clockOffsetMs: 0,
};

export function useSessions(filters: SessionFilters) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [now, setNow] = useState(() => Date.now());
  const controllerRef = useRef<AbortController | null>(null);
  const filtersKey = [filters.date, filters.levels.join(','), filters.location, filters.timeFrom, filters.timeTo].join('|');

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const result = await fetchSessions(filters, controller.signal);
      const receivedAt = Date.now();
      setNow(receivedAt);
      setState({
        sessions: sortChronologically(result.sessions),
        status: 'success',
        error: null,
        stale: false,
        lastUpdated: receivedAt,
        clockOffsetMs: Date.parse(result.serverTime) - receivedAt || 0,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
      setState((previous) =>
        previous.status === 'success'
          ? { ...previous, stale: true, error: message }
          : { ...previous, status: 'error', error: message },
      );
    }
    // filtersKey captures every field of `filters`, so the callback stays stable per filter set.
  }, [filtersKey]);

  // Initial load, reload on filter change, and refresh every minute.
  useEffect(() => {
    setState((previous) => ({ ...previous, status: 'loading', error: null, stale: false }));
    void load();
    const interval = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      controllerRef.current?.abort();
    };
  }, [load]);

  // Refresh right away when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  const serverNow = now + state.clockOffsetMs;
  const sessions = useMemo(
    () => state.sessions.filter((session) => startsAtMs(session) >= serverNow),
    [state.sessions, serverNow],
  );

  return {
    sessions,
    status: state.status,
    error: state.error,
    stale: state.stale,
    lastUpdated: state.lastUpdated,
    serverNow,
    refresh: load,
  };
}
