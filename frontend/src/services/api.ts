import type { ProcessingStatus, RawPost, RawPostsResult } from '../types/rawPost';
import type { Session, SessionFilters, SessionsResult } from '../types/session';

/** Empty = same origin (nginx routes /api to the backend). */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/u, '');

export const RAW_POSTS_PAGE_SIZE = 30;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T, M> {
  success: boolean;
  data?: T;
  meta?: M;
  error?: { message?: string };
}

async function getJson<T, M>(url: string, init: RequestInit = {}): Promise<{ data: T; meta: M | undefined }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { accept: 'application/json', ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng.');
  }

  const body = (await response.json().catch(() => null)) as Envelope<T, M> | null;
  if (!response.ok || !body?.success || body.data === undefined) {
    throw new ApiError(body?.error?.message ?? `Máy chủ gặp sự cố (mã ${response.status}).`, response.status);
  }
  return { data: body.data, meta: body.meta };
}

export function buildSessionsUrl(filters: Partial<SessionFilters>): string {
  const params = new URLSearchParams();
  const date = filters.date?.trim();
  if (date) params.set('date', date);
  if (filters.levels?.length) params.set('level', filters.levels.join(','));
  const location = filters.location?.trim();
  if (location) params.set('location', location);
  if (filters.timeFrom) params.set('timeFrom', filters.timeFrom);
  if (filters.timeTo) params.set('timeTo', filters.timeTo);
  params.set('limit', '200');
  return `${API_BASE}/api/v1/sessions?${params.toString()}`;
}

export async function fetchSessions(
  filters: Partial<SessionFilters>,
  signal?: AbortSignal,
): Promise<SessionsResult> {
  const { data, meta } = await getJson<Session[], { serverTime: string }>(buildSessionsUrl(filters), { signal });
  return { sessions: data, serverTime: meta?.serverTime ?? new Date().toISOString() };
}

export function buildRawPostsUrl(params: { page: number; status?: ProcessingStatus | '' }): string {
  const search = new URLSearchParams({ page: String(params.page), pageSize: String(RAW_POSTS_PAGE_SIZE) });
  if (params.status) search.set('status', params.status);
  return `${API_BASE}/api/v1/posts?${search.toString()}`;
}

/** Raw captured posts; requires the same API key the extension uses. */
export async function fetchRawPosts(
  params: { page: number; status?: ProcessingStatus | '' },
  apiKey: string,
  signal?: AbortSignal,
): Promise<RawPostsResult> {
  const { data, meta } = await getJson<RawPost[], Omit<RawPostsResult, 'posts'>>(buildRawPostsUrl(params), {
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!meta) throw new ApiError('Máy chủ trả về dữ liệu không đầy đủ.');
  return { posts: data, ...meta };
}
