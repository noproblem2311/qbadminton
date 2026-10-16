import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildSessionsUrl, fetchSessions } from '../src/services/api';
import { makeSession, sessionsResponse } from './fixtures';

describe('sessions API client', () => {
  it('builds a same-origin URL with only the non-empty filters', () => {
    expect(buildSessionsUrl({ date: '2026-10-16', levels: ['TB', 'TB_PLUS'], location: '' })).toBe(
      '/api/v1/sessions?date=2026-10-16&level=TB%2CTB_PLUS&limit=200',
    );
  });

  it('returns sessions and server time', async () => {
    const session = makeSession();
    const fetchMock = vi.fn().mockResolvedValue(sessionsResponse([session], '2026-10-15T11:00:00.000Z'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSessions({ location: 'Tuyên Sơn' });

    expect(result).toEqual({ sessions: [session], serverTime: '2026-10-15T11:00:00.000Z' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/sessions?location=Tuy%C3%AAn+S%C6%A1n&limit=200');
  });

  it('surfaces API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' } }), { status: 400 }),
      ),
    );
    await expect(fetchSessions({ date: 'x' })).rejects.toEqual(new ApiError('Invalid query parameters', 400));
  });

  it('reports network failures in Vietnamese', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchSessions({})).rejects.toThrow('Không thể kết nối tới máy chủ');
  });
});
