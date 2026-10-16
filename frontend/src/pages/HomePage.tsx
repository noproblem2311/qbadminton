import { useCallback, useEffect, useState } from 'react';
import { RefreshIcon } from '../components/icons';
import { SessionFilters } from '../components/SessionFilters';
import { SessionList } from '../components/SessionList';
import { EmptyState, ErrorState, LoadingState } from '../components/StatusViews';
import { useSessions } from '../hooks/useSessions';
import { formatClock, localDate } from '../lib/format';
import { EMPTY_FILTERS, LEVEL_CODES, type LevelCode, type SessionFilters as Filters } from '../types/session';

function readFiltersFromUrl(): Filters {
  const params = new URLSearchParams(window.location.search);
  const levels = (params.get('level') ?? '')
    .split(',')
    .filter((code): code is LevelCode => (LEVEL_CODES as string[]).includes(code));
  const time = (key: string) => {
    const value = params.get(key) ?? '';
    return /^([01]\d|2[0-3]):[0-5]\d$/u.test(value) ? value : '';
  };
  return {
    date: params.get('date') ?? '',
    levels: LEVEL_CODES.filter((code) => levels.includes(code)),
    location: params.get('location') ?? '',
    timeFrom: time('timeFrom'),
    timeTo: time('timeTo'),
  };
}

function writeFiltersToUrl(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.date) params.set('date', filters.date);
  if (filters.levels.length) params.set('level', filters.levels.join(','));
  if (filters.location) params.set('location', filters.location);
  if (filters.timeFrom) params.set('timeFrom', filters.timeFrom);
  if (filters.timeTo) params.set('timeTo', filters.timeTo);
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

export function HomePage() {
  const [filters, setFilters] = useState<Filters>(readFiltersFromUrl);
  const { sessions, status, error, stale, lastUpdated, serverNow, refresh } = useSessions(filters);

  useEffect(() => writeFiltersToUrl(filters), [filters]);
  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const today = localDate(serverNow);
  const hasFilters = Boolean(
    filters.date || filters.levels.length || filters.location || filters.timeFrom || filters.timeTo,
  );

  let content;
  if (status === 'loading' && sessions.length === 0) content = <LoadingState />;
  else if (status === 'error') content = <ErrorState message={error ?? ''} onRetry={() => void refresh()} />;
  else if (sessions.length === 0) content = <EmptyState filtered={hasFilters} onReset={resetFilters} />;
  else content = <SessionList sessions={sessions} now={serverNow} today={today} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-10 sm:pt-10">
          <p className="text-sm font-semibold tracking-wide text-emerald-200 uppercase">QBadminton</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Kèo cầu lông vãng lai</h1>
          <p className="mt-2 max-w-xl text-emerald-100">
            Tổng hợp bài tuyển người từ các nhóm Facebook. Chỉ hiển thị kèo chưa bắt đầu, sắp xếp theo giờ chơi gần nhất.
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-5 w-full max-w-6xl flex-1 space-y-5 px-4 pb-16">
        <SessionFilters value={filters} onChange={setFilters} today={today} />

        {stale && (
          <p
            role="status"
            className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900"
          >
            Không làm mới được dữ liệu ({error}). Đang hiển thị danh sách trước đó.
          </p>
        )}

        <div className="flex items-center justify-between text-sm text-slate-500">
          <span aria-live="polite">
            {status === 'success' || sessions.length > 0 ? `${sessions.length} kèo sắp diễn ra` : ' '}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <RefreshIcon className={`size-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>

        {content}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
        {lastUpdated ? `Cập nhật lúc ${formatClock(lastUpdated)} · ` : ''}Tự động làm mới mỗi phút · Giờ Việt Nam (GMT+7) ·{' '}
        <a href="/raw" className="underline hover:text-slate-700 dark:hover:text-slate-300">
          Dữ liệu thô
        </a>
      </footer>
    </div>
  );
}
