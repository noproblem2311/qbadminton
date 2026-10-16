import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeContainer, findPostContainers } from '../src/crawler/post.detector';
import { extractPost, findLazyLinks, findSeeMoreButton } from '../src/crawler/post.extractor';
import { GroupMonitor } from '../src/monitor/group.monitor';
import type { ExtractedPost } from '../src/types/messages';
import { parsePostLink } from '../src/utils/facebook-url';
import { feedChildren, loadFacebookFixture } from './helpers';

/** Behaviour against markup captured from a real group feed (anonymized). */
const CAPTURED_AT = new Date('2026-10-15T11:30:00+07:00');
const context = { groupId: 'danangbadminton', capturedAt: CAPTURED_AT };
const minutesBefore = (minutes: number) => new Date(CAPTURED_AT.getTime() - minutes * 60_000).toISOString();

describe('real Facebook feed markup', () => {
  beforeEach(() => loadFacebookFixture('facebook-group-feed.html'));

  it('finds the three posts and skips the sort control, virtualized items and skeleton', () => {
    const children = feedChildren();
    expect(children).toHaveLength(9);
    expect(findPostContainers(document, parsePostLink)).toEqual([children[1], children[2], children[3]]);
  });

  it('reads the author from profile_name, ignoring "Theo dõi" and the sort-control heading', () => {
    const authors = findPostContainers(document, parsePostLink).map((c) => extractPost(c, context)?.author);
    expect(authors).toEqual(['Ngô Thị Lan', 'Phạm Văn Bình', 'Lý Minh Khoa']);
  });

  it('takes text from story_message only (no decoys, link-preview duplicates or composer)', () => {
    const [first, second] = findPostContainers(document, parsePostLink).map((c) => extractPost(c, context)!);
    expect(first!.content).toBe('Tuyển vãng lai chiều nay\n⏰Thời gian: 15h - 17h\nĐịa điểm : Sân Lâm Gia, 17 Bàu Năng 11');
    expect(second!.content).toBe('Mình tuyển vlai 3h chiều nay sân Arena01 40 Hoàng Văn Thái. Phí thu cuối buổi');
    for (const junk of ['Facebook', 'Xem thêm', 'Bình luận dưới tên', 'example.com', 'Theo dõi', 'Nội dung do AI tạo']) {
      expect(first!.content + second!.content).not.toContain(junk);
    }
  });

  it('gets the post ID from group photo links (set=gm.<postId>)', () => {
    const posts = findPostContainers(document, parsePostLink).map((c) => extractPost(c, context)!);
    expect(posts.map((post) => post.postId)).toEqual([null, '30000000000000002', '30000000000000001']);
    expect(posts[1]!.postUrl).toBe('https://www.facebook.com/groups/danangbadminton/posts/30000000000000002/');
  });

  it('reads the publish time from the aria-labelledby target, not the scrambled text', () => {
    const posts = findPostContainers(document, parsePostLink).map((c) => extractPost(c, context)!);
    expect(posts.map((post) => post.publishedAt)).toEqual([null, minutesBefore(1), minutesBefore(2)]);
  });

  it('treats the "?__cft__…" timestamp link as lazy and finds "Xem thêm"', () => {
    const parts = analyzeContainer(feedChildren()[1]!);
    const lazy = findLazyLinks(parts);
    expect(lazy[0]?.getAttribute('href')).toMatch(/^\?__cft__/u);
    expect(findSeeMoreButton(parts)?.textContent).toBe('Xem thêm');
  });

  it('expands text and picks up the permalink Facebook writes on hover', async () => {
    // Simulate Facebook: "Xem thêm" expands in place; hovering the timestamp fills its href.
    const first = feedChildren()[1]!;
    const seeMore = findSeeMoreButton(analyzeContainer(first))!;
    seeMore.addEventListener('click', () => {
      const row = document.createElement('div');
      row.innerHTML = '<span>🏸Trình độ: TB, TB-</span>';
      seeMore.replaceWith(row);
    });
    const timestamp = findLazyLinks(analyzeContainer(first))[0]!;
    timestamp.addEventListener('mouseover', () => {
      timestamp.setAttribute('href', '/groups/100000000000001/posts/30000000000000003/?__cft__[0]=AZaaa&__tn__=%2CO%2CP-R');
    });

    const submitted: ExtractedPost[] = [];
    const monitor = new GroupMonitor({
      doc: document,
      getGroupId: () => 'danangbadminton',
      submit: async (posts) => {
        submitted.push(...posts);
      },
      now: () => CAPTURED_AT,
      lazyRetryMs: 20,
      observer: { debounceMs: 10, maxWaitMs: 50 },
    });
    await monitor.start();
    await vi.waitFor(() => expect(submitted).toHaveLength(3));
    monitor.stop();

    const lan = submitted.find((item) => item.post.author === 'Ngô Thị Lan')!;
    expect(lan.key).toBe('id:danangbadminton:30000000000000003');
    expect(lan.post).toMatchObject({
      postId: '30000000000000003',
      postUrl: 'https://www.facebook.com/groups/danangbadminton/posts/30000000000000003/',
      content: 'Tuyển vãng lai chiều nay\n⏰Thời gian: 15h - 17h\nĐịa điểm : Sân Lâm Gia, 17 Bàu Năng 11\n🏸Trình độ: TB, TB-',
    });
  });
});
