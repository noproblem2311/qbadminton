import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeContainer, findFeed, findPostContainers, isInsideComment, isPlaceholder } from '../src/crawler/post.detector';
import {
  extractPost,
  findLazyLinks,
  findSeeMoreButton,
  parseFacebookTimestamp,
} from '../src/crawler/post.extractor';
import { parseGroupId, parsePostLink } from '../src/utils/facebook-url';
import { feedChildren, loadFacebookFixture } from './helpers';

const CAPTURED_AT = new Date('2026-10-15T10:00:00+07:00');
const context = { groupId: 'caulongdanang', capturedAt: CAPTURED_AT };

describe('Facebook group DOM detection (fixture)', () => {
  beforeEach(() => loadFacebookFixture());

  it('finds the feed', () => {
    const feed = findFeed(document);
    expect(feed?.getAttribute('role')).toBe('feed');
    expect(feed?.childElementCount).toBe(7);
  });

  it('identifies posts and rejects sorting controls, placeholders and skeletons', () => {
    const children = feedChildren();
    const posts = findPostContainers(document, parsePostLink);
    expect(posts).toEqual([children[1], children[2], children[3], children[6]]);
    expect(isPlaceholder(children[4]!)).toBe(true);
    expect(isPlaceholder(children[5]!)).toBe(true);
  });

  it('extracts author, original content, permalink and time from a post', () => {
    const post = extractPost(feedChildren()[1]!, context);
    expect(post).toEqual({
      postId: '1234567890123456',
      postUrl: 'https://www.facebook.com/groups/caulongdanang/posts/1234567890123456/',
      groupId: 'caulongdanang',
      author: 'Nguyễn Văn A',
      content: 'Tối nay sân Tuyên Sơn thiếu 2 nam trình TB+,\n19h-21h, ai giao lưu được thì ib mình. 🏸',
      publishedAt: '2026-10-15T01:00:00.000Z',
      capturedAt: '2026-10-15T03:00:00.000Z',
    });
  });

  it('excludes comments, replies, comment links and UI labels', () => {
    const container = feedChildren()[1]!;
    const post = extractPost(container, context)!;
    for (const forbidden of ['Mình đăng ký', 'Ok bạn', 'Thích', 'Bình luận', 'Chia sẻ', '3 bình luận', 'Viết bình luận']) {
      expect(post.content).not.toContain(forbidden);
    }
    // The comment links to another post (9999…) and to the post's own comment.
    expect(post.postId).not.toBe('9999999999999999');

    const parts = analyzeContainer(container);
    const commentText = Array.from(container.querySelectorAll('[role="article"] div[dir="auto"]'));
    expect(commentText.length).toBeGreaterThan(0);
    expect(commentText.every((node) => isInsideComment(node, parts))).toBe(true);
    expect(isInsideComment(parts.message!, parts)).toBe(false);
  });

  it('handles the role=article layout, truncated text and a lazy timestamp link', () => {
    const container = feedChildren()[2]!;
    const parts = analyzeContainer(container);
    expect(parts.article).toBe(container.querySelector('[role="article"]'));
    expect(findSeeMoreButton(parts)?.textContent).toBe('Xem thêm');
    expect(findLazyLinks(parts)).toHaveLength(1);

    const post = extractPost(container, context)!;
    expect(post.author).toBe('Trần Thị B');
    expect(post.content).toBe('Cần tuyển 1 nữ trình TBY-TB, tối thứ 7 18h-20h sân Chi Lăng, Hải Châu');
    expect(post.content).not.toContain('Còn slot');
    expect(post.postId).toBeNull();
    expect(post.postUrl).toBeNull();
    expect(post.publishedAt).toBe('2026-10-15T00:00:00.000Z'); // "3 giờ" before capture
  });

  it('keeps line breaks and emoji, and reads /permalink/ and pfbid links', () => {
    const anonymous = extractPost(feedChildren()[3]!, context)!;
    expect(anonymous).toMatchObject({
      postId: '7777777777777777',
      author: 'Người tham gia ẩn danh',
      content: 'Sáng mai 6h sân Quân Khu 5 cần thêm 2 bạn nam TB khá 🏸\nAe ib nhé',
      publishedAt: '2026-10-14T14:30:00.000Z',
    });

    const pfbid = extractPost(feedChildren()[6]!, context)!;
    expect(pfbid.postId).toBe('pfbid02XyZabc123DEF456ghi789');
    expect(pfbid.postUrl).toBe('https://www.facebook.com/groups/caulongdanang/posts/pfbid02XyZabc123DEF456ghi789/');
    expect(pfbid.publishedAt).toBe('2026-10-15T01:05:00.000Z');
  });

  it('never fabricates missing fields', () => {
    const container = feedChildren()[6]!;
    container.querySelector('a[aria-label]')!.remove();
    const post = extractPost(container, context)!;
    expect(post.postId).toBeNull();
    expect(post.postUrl).toBeNull();
    expect(post.publishedAt).toBeNull();
  });

  it('returns null for an item without text', () => {
    expect(extractPost(feedChildren()[4]!, context)).toBeNull();
  });
});

describe('parsePostLink', () => {
  it.each([
    ['https://www.facebook.com/groups/caulongdanang/posts/1234567890123456/?__cft__[0]=x', { groupId: 'caulongdanang', postId: '1234567890123456' }],
    ['https://www.facebook.com/groups/123456789/permalink/7777777777777777/', { groupId: '123456789', postId: '7777777777777777' }],
    ['https://www.facebook.com/permalink.php?story_fbid=pfbid0abcdefghijk&id=100', { groupId: null, postId: 'pfbid0abcdefghijk' }],
    ['https://www.facebook.com/groups/caulongdanang/?multi_permalinks=55555555555', { groupId: 'caulongdanang', postId: '55555555555' }],
    ['https://web.facebook.com/nguyenvana/posts/pfbid02XyZabc123DEF/', { groupId: null, postId: 'pfbid02XyZabc123DEF' }],
    ['/groups/caulongdanang/posts/1234567890123456/', { groupId: 'caulongdanang', postId: '1234567890123456' }],
    ['https://www.facebook.com/photo/?fbid=3247256605484227&set=gm.39745849958346696&idorvanity=594956003862912', { groupId: '594956003862912', postId: '39745849958346696' }],
  ])('parses %s', (href, expected) => {
    expect(parsePostLink(href)).toEqual(expected);
  });

  it.each([
    'https://www.facebook.com/groups/caulongdanang/posts/1234567890123456/?comment_id=555',
    'https://www.facebook.com/groups/caulongdanang/posts/1234567890123456/?comment_id=5&reply_comment_id=6',
    'https://www.facebook.com/groups/caulongdanang/user/100012345678901/',
    'https://evil.example.com/groups/x/posts/1234567890123456/',
    '#',
    null,
  ])('rejects %s', (href) => {
    expect(parsePostLink(href)).toBeNull();
  });
});

describe('parseGroupId', () => {
  it('reads the group from group pages only', () => {
    expect(parseGroupId('https://www.facebook.com/groups/caulongdanang/?sorting_setting=CHRONOLOGICAL')).toBe('caulongdanang');
    expect(parseGroupId('https://www.facebook.com/groups/123456789/posts/1/')).toBe('123456789');
    expect(parseGroupId('https://www.facebook.com/groups/feed/')).toBeNull();
    expect(parseGroupId('https://www.facebook.com/nguyenvana')).toBeNull();
    expect(parseGroupId('https://example.com/groups/caulongdanang/')).toBeNull();
  });
});

describe('parseFacebookTimestamp', () => {
  const at = (iso: string | undefined) => (iso ? new Date(iso).toISOString() : null);

  it.each([
    ['Vừa xong', '2026-10-15T10:00:00+07:00'],
    ['15 phút', '2026-10-15T09:45:00+07:00'],
    ['khoảng 1 phút trước', '2026-10-15T09:59:00+07:00'],
    ['khoảng một giờ trước', '2026-10-15T09:00:00+07:00'],
    ['about an hour ago', '2026-10-15T09:00:00+07:00'],
    ['2 phút trước', '2026-10-15T09:58:00+07:00'],
    ['2 giờ', '2026-10-15T08:00:00+07:00'],
    ['3 ngày', '2026-10-12T10:00:00+07:00'],
    ['1 tuần', '2026-10-08T10:00:00+07:00'],
    ['5m', '2026-10-15T09:55:00+07:00'],
    ['2 hrs', '2026-10-15T08:00:00+07:00'],
    ['Hôm qua lúc 21:30', '2026-10-14T21:30:00+07:00'],
    ['Yesterday at 9:15 PM', '2026-10-14T21:15:00+07:00'],
    ['15 tháng 10 lúc 08:05', '2026-10-15T08:05:00+07:00'],
    ['Thứ Năm, 15 tháng 10, 2026 lúc 08:05', '2026-10-15T08:05:00+07:00'],
    ['20 tháng 12', '2025-12-20T00:00:00+07:00'],
    ['October 14 at 7:00 AM', '2026-10-14T07:00:00+07:00'],
  ])('parses "%s"', (text, expected) => {
    expect(parseFacebookTimestamp(text, CAPTURED_AT)?.toISOString()).toBe(at(expected));
  });

  it.each(['Nguyễn Văn A', '', 'Thích', '31 tháng 2', 'Ngày mai lúc 10:00'])('rejects "%s"', (text) => {
    expect(parseFacebookTimestamp(text, CAPTURED_AT)).toBeNull();
  });
});
