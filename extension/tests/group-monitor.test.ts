import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeFingerprint, postKey } from '../src/crawler/post.deduplicator';
import { GroupMonitor, canRefreshNow } from '../src/monitor/group.monitor';
import type { ExtractedPost } from '../src/types/messages';
import { buildPost, feedChildren, loadFacebookFixture } from './helpers';

function createMonitor() {
  const batches: ExtractedPost[][] = [];
  const monitor = new GroupMonitor({
    doc: document,
    getGroupId: () => 'caulongdanang',
    submit: async (posts) => {
      batches.push(posts);
    },
    now: () => new Date('2026-10-15T10:00:00+07:00'),
    observer: { debounceMs: 10, maxWaitMs: 50 },
    lazyRetryMs: 20,
  });
  const submitted = () => batches.flat().map((item) => item.post);
  return { monitor, batches, submitted };
}

/** Simulate Facebook expanding truncated text when "Xem thêm" is clicked. */
function wireSeeMore() {
  const container = feedChildren()[2]!;
  const button = container.querySelector<HTMLElement>('[role="button"]')!;
  button.addEventListener('click', () => {
    button.parentElement!.textContent = 'Cần tuyển 1 nữ trình TBY-TB, tối thứ 7 18h-20h sân Chi Lăng, Hải Châu, có nước miễn phí.';
  });
}

describe('GroupMonitor', () => {
  let current: ReturnType<typeof createMonitor> | null = null;

  beforeEach(() => {
    loadFacebookFixture();
    wireSeeMore();
  });
  afterEach(() => current?.monitor.stop());

  it('scans immediately, expands truncated posts, then submits them once', async () => {
    current = createMonitor();
    const { monitor, submitted } = current;

    const first = await monitor.start();
    // The truncated post is held back until Facebook expands it.
    expect(first).toMatchObject({ candidates: 4, extracted: 3 });

    await vi.waitFor(() => expect(submitted()).toHaveLength(4));
    const expanded = submitted().find((post) => post.author === 'Trần Thị B');
    expect(expanded?.content).toBe(
      'Cần tuyển 1 nữ trình TBY-TB, tối thứ 7 18h-20h sân Chi Lăng, Hải Châu, có nước miễn phí.',
    );
    expect(submitted().map((post) => post.author)).toEqual([
      'Nguyễn Văn A',
      'Người tham gia ẩn danh',
      'Lê Văn D',
      'Trần Thị B',
    ]);
  });

  it('does not extract or submit the same posts twice', async () => {
    current = createMonitor();
    await current.monitor.start();
    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(4));

    const again = await current.monitor.scan();
    expect(again?.extracted).toBe(0);
    expect(current.submitted()).toHaveLength(4);
  });

  it('picks up posts added to the feed via MutationObserver', async () => {
    current = createMonitor();
    await current.monitor.start();
    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(4));

    document.querySelector('[role="feed"]')!.prepend(
      buildPost({ author: 'Võ Thị E', text: 'Chiều nay 17h sân Hòa Xuân thiếu 1 nam TB', postId: '8888888888888888' }),
    );

    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(5));
    expect(current.submitted()[4]).toMatchObject({ author: 'Võ Thị E', postId: '8888888888888888' });
  });

  it('dedupes identical ID-less posts by fingerprint', async () => {
    current = createMonitor();
    await current.monitor.start();
    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(4));

    const feed = document.querySelector('[role="feed"]')!;
    feed.append(buildPost({ author: 'Đỗ F', text: 'Tối mai thiếu 2 nữ' }));
    feed.append(buildPost({ author: 'Đỗ F', text: 'Tối mai   thiếu 2 nữ' }));

    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(5));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(current.submitted()).toHaveLength(5);
  });

  it('stops observing after stop()', async () => {
    current = createMonitor();
    await current.monitor.start();
    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(4));
    current.monitor.stop();

    document.querySelector('[role="feed"]')!.append(buildPost({ author: 'G', text: 'Bài mới', postId: '1111111111111' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(current.submitted()).toHaveLength(4);
    expect(await current.monitor.scan()).toBeNull();
  });

  it('runs scans one at a time', async () => {
    current = createMonitor();
    await current.monitor.start();
    await vi.waitFor(() => expect(current!.submitted()).toHaveLength(4));

    const feed = document.querySelector('[role="feed"]')!;
    feed.append(buildPost({ author: 'H', text: 'Kèo tối nay', postId: '2222222222222' }));
    await Promise.all([current.monitor.scan(), current.monitor.scan(), current.monitor.scan()]);
    expect(current.submitted().filter((post) => post.author === 'H')).toHaveLength(1);
  });
});

describe('post keys', () => {
  const base = { postUrl: null, groupId: 'g', publishedAt: null, capturedAt: '2026-10-15T03:00:00.000Z' };

  it('keeps Facebook IDs and fingerprints in separate namespaces', async () => {
    expect(await postKey({ ...base, postId: '123456', author: 'A', content: 'x' })).toBe('id:g:123456');
    expect(await postKey({ ...base, postId: null, author: 'A', content: 'x' })).toMatch(/^fp:[0-9a-f]{64}$/u);
  });

  it('fingerprints are deterministic and whitespace/case insensitive', async () => {
    const a = await computeFingerprint({ groupId: 'g', author: 'An', content: 'Thiếu 2 nam\n19h' });
    const b = await computeFingerprint({ groupId: 'g', author: 'an', content: '  thiếu 2 nam 19h … Xem thêm' });
    const c = await computeFingerprint({ groupId: 'other', author: 'An', content: 'Thiếu 2 nam 19h' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('canRefreshNow', () => {
  it('defers while the user types or has just interacted', () => {
    const now = 1_000_000;
    expect(canRefreshNow(document, 0, now)).toEqual({ ok: true });
    expect(canRefreshNow(document, now - 5_000, now).ok).toBe(false);

    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    expect(canRefreshNow(document, 0, now)).toEqual({ ok: false, reason: 'user is typing' });
    box.remove();
  });
});
