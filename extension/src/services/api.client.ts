import type { BackendStatus, Settings } from '../types/monitor';
import type { RawFacebookPost } from '../types/post';

export interface IngestSummary {
  received: number;
  accepted: number;
  duplicates: number;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Worth retrying later (network, 5xx, 429, or fixable config such as a bad key). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export const baseUrl = (settings: Pick<Settings, 'backendUrl'>) => settings.backendUrl.trim().replace(/\/+$/u, '');

/** REST client for the QBadminton backend. Only post data is sent — never cookies or tokens. */
export class ApiClient {
  constructor(
    private readonly getSettings: () => Promise<Settings>,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async ingest(posts: RawFacebookPost[]): Promise<IngestSummary> {
    const settings = await this.getSettings();
    if (!settings.apiKey) throw new ApiRequestError('Chưa nhập API key trong phần cài đặt', null, true);

    const response = await this.request(`${baseUrl(settings)}/api/v1/posts/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ posts }),
    });
    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: IngestSummary; error?: { message?: string } }
      | null;

    if (response.ok && body?.success && body.data) return body.data;
    throw toRequestError(response.status, body?.error?.message);
  }

  async health(): Promise<BackendStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const settings = await this.getSettings();
      const response = await this.request(`${baseUrl(settings)}/health`, { method: 'GET' });
      const body = (await response.json().catch(() => null)) as { status?: string; database?: string } | null;
      if (response.ok && body?.status === 'ok') return { ok: true, checkedAt, message: null };
      return { ok: false, checkedAt, message: `Máy chủ trả về ${response.status}${body?.database ? ` (database: ${body.database})` : ''}` };
    } catch (error) {
      return { ok: false, checkedAt, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'hết thời gian chờ' : 'lỗi mạng';
      throw new ApiRequestError(`Không kết nối được máy chủ (${reason})`, null, true);
    }
  }
}

function toRequestError(status: number, message: string | undefined): ApiRequestError {
  if (status === 401) return new ApiRequestError('API key không hợp lệ', status, true);
  if (status === 408 || status === 429 || status >= 500) {
    return new ApiRequestError(`Máy chủ tạm thời lỗi (${status})`, status, true);
  }
  return new ApiRequestError(message ?? `Yêu cầu bị từ chối (${status})`, status, false);
}
