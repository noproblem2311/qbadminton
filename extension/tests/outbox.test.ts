// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ApiClient, ApiRequestError } from '../src/services/api.client';
import { Outbox, backoffDelay, type OutboxEvents } from '../src/services/outbox.service';
import { StorageService } from '../src/services/storage.service';
import type { ExtractedPost } from '../src/types/messages';
import type { RawFacebookPost } from '../src/types/post';

const post = (id: string, content = `Kèo ${id}`): ExtractedPost => ({
  key: `id:g:${id}`,
  post: {
    postId: id,
    postUrl: null,
    groupId: 'g',
    author: 'A',
    content,
    publishedAt: null,
    capturedAt: '2026-10-15T03:00:00.000Z',
  },
});

const OPTIONS = { batchSize: 25, maxAttempts: 3, backoffBaseMs: 5_000, backoffMaxMs: 60_000, maxQueue: 100, maxSentKeys: 3 };

describe('Outbox', () => {
  let storage: StorageService;
  let events: OutboxEvents & { onSubmitted: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn>; scheduleRetry: ReturnType<typeof vi.fn> };
  let clock: number;
  const ingest = vi.fn<(posts: RawFacebookPost[]) => Promise<{ received: number; accepted: number; duplicates: number }>>();
  const outbox = () => new Outbox(storage, { ingest }, events, OPTIONS, () => clock);

  beforeEach(() => {
    fakeBrowser.reset();
    storage = new StorageService();
    events = { onSubmitted: vi.fn(), onError: vi.fn(), scheduleRetry: vi.fn() };
    clock = Date.parse('2026-10-15T03:00:00Z');
    ingest.mockReset();
  });

  it('queues only posts that are neither queued nor already acknowledged', async () => {
    await storage.set('sentKeys', ['id:g:1']);
    const box = outbox();
    expect(await box.enqueue([post('1'), post('2'), post('2')], 'm1')).toBe(1);
    expect(await box.enqueue([post('2'), post('3')], 'm1')).toBe(1);
    expect((await storage.get('outbox')).map((item) => item.key)).toEqual(['id:g:2', 'id:g:3']);
  });

  it('submits queued posts, remembers their keys and reports per monitor', async () => {
    ingest.mockResolvedValue({ received: 3, accepted: 3, duplicates: 0 });
    const box = outbox();
    await box.enqueue([post('1'), post('2')], 'm1');
    await box.enqueue([post('3')], 'm2');
    await box.flush();

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]?.[0].map((p) => p.postId)).toEqual(['1', '2', '3']);
    expect(await storage.get('outbox')).toEqual([]);
    expect(await storage.get('sentKeys')).toEqual(['id:g:1', 'id:g:2', 'id:g:3']);
    expect(events.onSubmitted).toHaveBeenCalledWith('m1', 2);
    expect(events.onSubmitted).toHaveBeenCalledWith('m2', 1);

    // Bounded memory of acknowledged keys.
    await box.enqueue([post('4')], 'm1');
    await box.flush();
    expect(await storage.get('sentKeys')).toEqual(['id:g:2', 'id:g:3', 'id:g:4']);
  });

  it('retries failures with exponential backoff and respects the wait', async () => {
    ingest.mockRejectedValue(new ApiRequestError('Không kết nối được máy chủ', null, true));
    const box = outbox();
    await box.enqueue([post('1')], 'm1');

    await box.flush();
    expect(events.scheduleRetry).toHaveBeenLastCalledWith(5_000);
    expect((await storage.get('outbox'))[0]?.attempts).toBe(1);
    expect(events.onError).toHaveBeenCalledWith(['m1'], 'Không kết nối được máy chủ');

    // Still inside the backoff window: no request.
    clock += 1_000;
    await box.flush();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(events.scheduleRetry).toHaveBeenLastCalledWith(4_000);

    clock += 4_000;
    await box.flush();
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(events.scheduleRetry).toHaveBeenLastCalledWith(10_000);

    // Recovery resets the backoff.
    ingest.mockResolvedValue({ received: 1, accepted: 1, duplicates: 0 });
    clock += 10_000;
    await box.flush();
    expect(await storage.get('outbox')).toEqual([]);
    expect(await storage.get('outboxRetry')).toEqual({ failures: 0, nextAttemptAt: null, lastError: null });
  });

  it('gives up on an item after the attempt limit', async () => {
    ingest.mockRejectedValue(new ApiRequestError('Máy chủ tạm thời lỗi (503)', 503, true));
    const box = outbox();
    await box.enqueue([post('1')], 'm1');
    for (let attempt = 0; attempt < OPTIONS.maxAttempts; attempt += 1) {
      await box.flush();
      clock += 120_000;
    }
    expect(await storage.get('outbox')).toEqual([]);
    expect(events.onError).toHaveBeenLastCalledWith(['m1'], expect.stringContaining('bỏ 1 bài'));
  });

  it('isolates a rejected post instead of dropping the whole batch', async () => {
    ingest.mockImplementation(async (posts) => {
      if (posts.some((p) => p.postId === 'bad')) throw new ApiRequestError('Invalid ingest payload', 400, false);
      return { received: posts.length, accepted: posts.length, duplicates: 0 };
    });
    const box = outbox();
    await box.enqueue([post('1'), post('bad'), post('2')], 'm1');
    await box.flush();

    expect(await storage.get('outbox')).toEqual([]);
    expect(await storage.get('sentKeys')).toEqual(['id:g:1', 'id:g:2']);
    expect(events.onError).toHaveBeenCalledWith(['m1'], expect.stringContaining('Invalid ingest payload'));
  });

  it('computes bounded backoff delays', () => {
    expect([1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n, OPTIONS))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe('ApiClient', () => {
  const settings = { backendUrl: 'http://localhost:8082/', apiKey: 'secret-key', refreshIntervalMinutes: 3 };

  it('posts raw posts with the API key and without cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { received: 1, accepted: 1, duplicates: 0, results: [] } }), { status: 200 }),
    );
    const client = new ApiClient(async () => settings, fetchMock);
    const summary = await client.ingest([post('1').post]);

    expect(summary).toMatchObject({ accepted: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8082/api/v1/posts/ingest');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-key', 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ posts: [post('1').post] });
  });

  it.each([
    [401, true],
    [429, true],
    [503, true],
    [400, false],
  ])('maps HTTP %i to retryable=%s', async (status, retryable) => {
    const client = new ApiClient(async () => settings, vi.fn().mockResolvedValue(new Response('{}', { status })));
    const error = await client.ingest([post('1').post]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).retryable).toBe(retryable);
  });

  it('treats network failures and a missing key as retryable', async () => {
    const offline = new ApiClient(async () => settings, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(offline.ingest([post('1').post])).rejects.toMatchObject({ retryable: true });

    const noKey = new ApiClient(async () => ({ ...settings, apiKey: '' }), vi.fn());
    await expect(noKey.ingest([post('1').post])).rejects.toMatchObject({ retryable: true, status: null });
  });

  it('reports backend health', async () => {
    const ok = new ApiClient(async () => settings, vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"ok"}', { status: 200 })));
    expect(await ok.health()).toMatchObject({ ok: true, message: null });

    const down = new ApiClient(async () => settings, vi.fn().mockResolvedValue(new Response('{"status":"error","database":"unreachable"}', { status: 503 })));
    expect(await down.health()).toMatchObject({ ok: false, message: expect.stringContaining('503') });
  });
});
