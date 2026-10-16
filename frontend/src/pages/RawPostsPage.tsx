import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { RefreshIcon } from '../components/icons';
import { Pagination } from '../components/Pagination';
import { RawPostCard, STATUS_LABELS } from '../components/RawPostCard';
import { clearApiKey, loadApiKey, saveApiKey } from '../lib/apiKey';
import { ApiError, RAW_POSTS_PAGE_SIZE, fetchRawPosts } from '../services/api';
import { PROCESSING_STATUSES, type ProcessingStatus, type RawPostsResult } from '../types/rawPost';

interface Params {
  page: number;
  status: ProcessingStatus | '';
}

function readParams(): Params {
  const search = new URLSearchParams(window.location.search);
  const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1);
  const status = search.get('status') ?? '';
  return { page, status: (PROCESSING_STATUSES as string[]).includes(status) ? (status as ProcessingStatus) : '' };
}

function writeParams({ page, status }: Params) {
  const search = new URLSearchParams();
  if (page > 1) search.set('page', String(page));
  if (status) search.set('status', status);
  const query = search.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

interface LoadState {
  data: RawPostsResult | null;
  loading: boolean;
  error: string | null;
}

export function RawPostsPage() {
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [params, setParams] = useState<Params>(readParams);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<LoadState>({ data: null, loading: true, error: null });

  useEffect(() => writeParams(params), [params]);

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    fetchRawPosts(params, apiKey, controller.signal).then(
      (data) => setState({ data, loading: false, error: null }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          clearApiKey();
          setApiKey('');
          setKeyError('API key không đúng. Vui lòng nhập lại.');
          return;
        }
        const message = error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
        setState((previous) => ({ ...previous, loading: false, error: message }));
      },
    );
    return () => controller.abort();
  }, [apiKey, params, reloadToken]);

  const goTo = (page: number) => {
    setParams((previous) => ({ ...previous, page }));
    document.getElementById('raw-top')?.scrollIntoView?.({ behavior: 'smooth' });
  };

  if (!apiKey) {
    return (
      <Shell>
        <KeyForm
          error={keyError}
          onSubmit={(key) => {
            saveApiKey(key);
            setKeyError(null);
            setApiKey(key);
          }}
        />
      </Shell>
    );
  }

  const { data, loading, error } = state;
  const total = data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : 0;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <Shell
      onChangeKey={() => {
        clearApiKey();
        setApiKey('');
      }}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
        <FilterChip active={params.status === ''} onClick={() => setParams({ page: 1, status: '' })}>
          Tất cả{data ? ` (${total})` : ''}
        </FilterChip>
        {PROCESSING_STATUSES.map((status) => (
          <FilterChip key={status} active={params.status === status} onClick={() => setParams({ page: 1, status })}>
            {STATUS_LABELS[status]}
            {data ? ` (${data.counts[status]})` : ''}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <span aria-live="polite">
          {data ? (data.total > 0 ? `Hiển thị ${from}–${to} trong ${data.total} bài` : 'Không có bài nào') : ' '}
        </span>
        <button
          type="button"
          onClick={() => setReloadToken((value) => value + 1)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-slate-200/60 dark:hover:bg-slate-800"
        >
          <RefreshIcon className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
          Không tải được dữ liệu: {error}
        </p>
      )}

      {data && (
        <>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={goTo} />
          <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            {data.posts.map((post) => (
              <RawPostCard key={post.id} post={post} />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={goTo} />
        </>
      )}
      {!data && loading && <p className="text-sm text-slate-500">Đang tải…</p>}
    </Shell>
  );
}

function Shell({ children, onChangeKey }: { children: ReactNode; onChangeKey?: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header id="raw-top" className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-3 px-4 py-6">
          <div>
            <a href="/" className="text-sm text-slate-300 hover:text-white">
              ← Trang chủ
            </a>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Dữ liệu thô</h1>
            <p className="mt-1 text-sm text-slate-300">
              Toàn bộ bài extension đã thu thập, mới nhất trước · {RAW_POSTS_PAGE_SIZE} bài mỗi trang
            </p>
          </div>
          {onChangeKey && (
            <button type="button" onClick={onChangeKey} className="text-sm text-slate-300 underline hover:text-white">
              Đổi API key
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
          : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function KeyForm({ error, onSubmit }: { error: string | null; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-md space-y-3 rounded-2xl bg-white p-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
    >
      <h2 className="text-lg font-semibold">Nhập API key</h2>
      <p className="text-sm text-slate-500">
        Trang này chỉ dành cho chủ hệ thống. Dùng cùng API key đã nhập trong extension (INGEST_API_KEY).
      </p>
      <label className="block">
        <span className="sr-only">API key</span>
        <input
          type="password"
          autoComplete="off"
          aria-label="API key"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800">
        Xem dữ liệu
      </button>
    </form>
  );
}
