import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RawPostsPage } from '../src/pages/RawPostsPage';
import type { RawPost } from '../src/types/rawPost';

const counts = { pending: 33, processing: 0, parsed: 1, duplicate: 0, irrelevant: 0, failed: 1 };

function rawPost(index: number, overrides: Partial<RawPost> = {}): RawPost {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    facebookPostId: `3974584995834${index}`,
    groupId: 'danangbadminton',
    postUrl: `https://www.facebook.com/groups/danangbadminton/posts/3974584995834${index}/`,
    author: `Người đăng ${index}`,
    content: `Nội dung bài ${index}`,
    publishedAt: null,
    capturedAt: '2026-10-15T04:27:57.000Z',
    processingStatus: 'pending',
    processingAttempts: 0,
    lastError: null,
    duplicateOfPostId: null,
    skipReason: null,
    sessionCount: 0,
    createdAt: '2026-10-15T04:27:57.000Z',
    ...overrides,
  };
}

function pageResponse(page: number, posts: RawPost[], total = 35) {
  return new Response(
    JSON.stringify({
      success: true,
      data: posts,
      meta: { page, pageSize: 30, total, totalPages: Math.max(1, Math.ceil(total / 30)), counts },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const firstPage = () => pageResponse(1, Array.from({ length: 30 }, (_, i) => rawPost(i + 1)));
const secondPage = () => pageResponse(2, Array.from({ length: 5 }, (_, i) => rawPost(i + 31)));

function enterKey(key = 'secret-key') {
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Xem dữ liệu' }));
}

describe('RawPostsPage', () => {
  it('asks for the API key, then loads 30 posts with it', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => firstPage());
    vi.stubGlobal('fetch', fetchMock);

    render(<RawPostsPage />);
    expect(fetchMock).not.toHaveBeenCalled();
    enterKey();

    expect(await screen.findByText('Hiển thị 1–30 trong 35 bài')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(30);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/posts?page=1&pageSize=30');
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-key' });
    expect(localStorage.getItem('qbadminton.apiKey')).toBe('secret-key');
    expect(screen.getByRole('button', { name: /^Chờ xử lý \(33\)/u })).toBeInTheDocument();
  });

  it('pages through results and mirrors the page in the URL', async () => {
    localStorage.setItem('qbadminton.apiKey', 'secret-key');
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => firstPage())
      .mockImplementation(async () => secondPage());
    vi.stubGlobal('fetch', fetchMock);

    render(<RawPostsPage />);
    await screen.findByText('Hiển thị 1–30 trong 35 bài');

    fireEvent.click(screen.getAllByRole('button', { name: 'Sau →' })[0]!);

    expect(await screen.findByText('Hiển thị 31–35 trong 35 bài')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/posts?page=2&pageSize=30', expect.anything());
    expect(window.location.search).toBe('?page=2');
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('filters by status and goes back to page 1', async () => {
    localStorage.setItem('qbadminton.apiKey', 'secret-key');
    window.history.replaceState(null, '', '/raw?page=2');
    const failed = rawPost(99, { processingStatus: 'failed', lastError: 'RateLimitError (429): slow down' });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => secondPage())
      .mockImplementation(async () => pageResponse(1, [failed], 1));
    vi.stubGlobal('fetch', fetchMock);

    render(<RawPostsPage />);
    await screen.findByText('Hiển thị 31–35 trong 35 bài');

    fireEvent.click(screen.getByRole('button', { name: /^Lỗi \(1\)/u }));

    expect(await screen.findByText('RateLimitError (429): slow down')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/posts?page=1&pageSize=30&status=failed', expect.anything());
    expect(window.location.search).toBe('?status=failed');
  });

  it('asks again when the stored key is rejected', async () => {
    localStorage.setItem('qbadminton.apiKey', 'old-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' } }), {
            status: 401,
          }),
      ),
    );

    render(<RawPostsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('API key không đúng');
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('qbadminton.apiKey')).toBeNull());
  });
});
