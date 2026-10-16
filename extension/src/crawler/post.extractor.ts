import type { RawFacebookPost } from '../types/post';
import { canonicalPostUrl, parsePostLink } from '../utils/facebook-url';
import { SEE_MORE_LABEL, extractText, textOf } from './dom.utils';
import { analyzeContainer, findBodyBlocks, isInsideComment, type PostParts } from './post.detector';

export interface ExtractContext {
  /** Group of the monitored page; used for every post on it. */
  groupId: string | null;
  capturedAt: Date;
}

const MAX_AUTHOR_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;

/** Links outside comments and outside the post text (which may link to other posts). */
function headerAnchors(parts: PostParts): HTMLAnchorElement[] {
  return Array.from(parts.container.querySelectorAll<HTMLAnchorElement>('a')).filter(
    (anchor) => !isInsideComment(anchor, parts) && !parts.message?.contains(anchor),
  );
}

export function extractAuthor(parts: PostParts): string | null {
  if (!parts.heading) return null;
  const link = Array.from(parts.heading.querySelectorAll('a')).find((anchor) => textOf(anchor));
  const raw = link ? textOf(link) : textOf(parts.heading);
  // Drop "▶ Group name", "· Theo dõi" and similar suffixes.
  const name = raw.split(/\s+[·›▶»]\s+/u)[0]?.trim() ?? '';
  return name ? name.slice(0, MAX_AUTHOR_LENGTH) : null;
}

export function extractContent(parts: PostParts): string {
  const text = parts.message
    ? extractText(parts.message)
    : findBodyBlocks(parts)
        .map((block) => extractText(block))
        .filter(Boolean)
        .join('\n');
  return text.slice(0, MAX_CONTENT_LENGTH);
}

export function extractPermalink(
  parts: PostParts,
  groupId: string | null,
): { postId: string | null; postUrl: string | null } {
  // The header timestamp link is the first post link in document order.
  for (const anchor of headerAnchors(parts)) {
    const link = parsePostLink(anchor.getAttribute('href'));
    if (link) return { postId: link.postId, postUrl: canonicalPostUrl(groupId ?? link.groupId, link.postId) };
  }
  return { postId: null, postUrl: null };
}

/**
 * Header links whose real href Facebook only fills in on hover — typically the
 * timestamp, rendered as `href="?__cft__[0]=…#?xyz"` or `href="#"` until then.
 */
export function findLazyLinks(parts: PostParts): HTMLAnchorElement[] {
  return headerAnchors(parts).filter((anchor) => {
    if (parts.heading?.contains(anchor)) return false;
    const href = anchor.getAttribute('href');
    return href === null || href === '' || href.startsWith('#') || href.startsWith('?');
  });
}

/** Text of the element(s) an `aria-labelledby` on the anchor (or inside it) points to. */
function labelledByText(anchor: HTMLAnchorElement): string | null {
  const ids =
    anchor.getAttribute('aria-labelledby') ??
    anchor.querySelector('[aria-labelledby]')?.getAttribute('aria-labelledby');
  if (!ids) return null;
  const text = ids
    .split(/\s+/u)
    .map((id) => textOf(anchor.ownerDocument.getElementById(id)))
    .filter(Boolean)
    .join(' ');
  return text || null;
}

export function findSeeMoreButton(parts: PostParts): HTMLElement | null {
  const scope = parts.message ?? parts.container;
  for (const button of scope.querySelectorAll<HTMLElement>('[role="button"]')) {
    if (SEE_MORE_LABEL.test(textOf(button)) && !isInsideComment(button, parts)) return button;
  }
  return null;
}

const VI_MONTH = String.raw`(\d{1,2}) tháng (\d{1,2})`;
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  year: 365 * 86_400_000,
};
const UNIT_ALIASES: Array<[RegExp, keyof typeof UNIT_MS]> = [
  [/^(?:phút|m|min|mins|minutes?)$/u, 'minute'],
  [/^(?:giờ|h|hr|hrs|hours?)$/u, 'hour'],
  [/^(?:ngày|d|days?)$/u, 'day'],
  [/^(?:tuần|w|wk|weeks?)$/u, 'week'],
  [/^(?:năm|y|yr|years?)$/u, 'year'],
];

function to24h(hours: number, meridiem: string | undefined): number {
  if (!meridiem) return hours;
  const pm = /^(?:pm|ch)$/iu.test(meridiem);
  if (pm && hours < 12) return hours + 12;
  if (!pm && hours === 12) return 0;
  return hours;
}

function localDate(year: number, month: number, day: number, hours = 0, minutes = 0): Date | null {
  const date = new Date(year, month - 1, day, hours, minutes);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Parse Facebook's displayed timestamps ("Vừa xong", "2 giờ", "Hôm qua lúc 21:30",
 * "15 tháng 10 lúc 09:15", "October 15 at 9:15 AM", …) in the viewer's time zone.
 * Returns null for anything unrecognized rather than guessing.
 */
export function parseFacebookTimestamp(text: string | null | undefined, capturedAt: Date): Date | null {
  if (!text) return null;
  const value = text
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^(?:thứ (?:hai|ba|tư|năm|sáu|bảy)|chủ nhật|monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s*/u, '')
    // "khoảng 1 phút trước", "about an hour ago"
    .replace(/^(?:khoảng|about)\s+/u, '')
    .replace(/^(?:một|an?)\s+/u, '1 ');
  const now = capturedAt.getTime();
  let result: Date | null = null;

  if (/^(?:vừa xong|just now)$/u.test(value)) return new Date(now);

  const relative = /^(\d{1,3})\s*([a-zà-ỹ]+)(?: trước| ago)?$/u.exec(value);
  if (relative?.[1] && relative[2]) {
    const unit = UNIT_ALIASES.find(([pattern]) => pattern.test(relative[2] ?? ''))?.[1];
    if (unit) result = new Date(now - Number(relative[1]) * (UNIT_MS[unit] ?? 0));
  }

  const yesterday = /^(?:hôm qua|yesterday) (?:lúc|at) (\d{1,2}):(\d{2})\s*(am|pm|sa|ch)?$/u.exec(value);
  if (!result && yesterday?.[1] && yesterday[2]) {
    const day = new Date(now - UNIT_MS.day!);
    result = localDate(day.getFullYear(), day.getMonth() + 1, day.getDate(), to24h(Number(yesterday[1]), yesterday[3]), Number(yesterday[2]));
  }

  const vi = new RegExp(String.raw`^${VI_MONTH}(?:,? (\d{4}))?(?: lúc (\d{1,2}):(\d{2}))?$`, 'u').exec(value);
  const en = /^([a-z]+) (\d{1,2})(?:, (\d{4}))?(?: at (\d{1,2}):(\d{2}) ?(am|pm)?)?$/u.exec(value);
  if (!result && (vi || (en && EN_MONTHS.includes(en[1] ?? '')))) {
    const [day, month, year, hours, minutes, meridiem] = vi
      ? [Number(vi[1]), Number(vi[2]), vi[3], vi[4], vi[5], undefined]
      : [Number(en![2]), EN_MONTHS.indexOf(en![1]!) + 1, en![3], en![4], en![5], en![6]];
    const h = hours === undefined ? 0 : to24h(Number(hours), meridiem);
    const m = minutes === undefined ? 0 : Number(minutes);
    const thisYear = capturedAt.getFullYear();
    result = localDate(year ? Number(year) : thisYear, month, day, h, m);
    // Without a year, a date "after" the capture time belongs to last year.
    if (result && !year && result.getTime() > now + UNIT_MS.day!) {
      result = localDate(thisYear - 1, month, day, h, m);
    }
  }

  if (!result || Number.isNaN(result.getTime()) || result.getTime() > now + 5 * 60_000) return null;
  return result;
}

export function extractPublishedAt(parts: PostParts, capturedAt: Date): string | null {
  const utime = parts.container.querySelector('[data-utime]');
  if (utime && !isInsideComment(utime, parts)) {
    const seconds = Number(utime.getAttribute('data-utime'));
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  }
  for (const anchor of headerAnchors(parts)) {
    if (parts.heading?.contains(anchor)) continue;
    // Facebook scrambles the visible timestamp; the readable one sits in an aria-labelledby target.
    for (const label of [labelledByText(anchor), anchor.getAttribute('aria-label'), textOf(anchor)]) {
      const parsed = parseFacebookTimestamp(label, capturedAt);
      if (parsed) return parsed.toISOString();
    }
  }
  return null;
}

/** Extract one post; null when the container has no usable text yet. */
export function extractPost(
  container: HTMLElement,
  context: ExtractContext,
  parts: PostParts = analyzeContainer(container),
): RawFacebookPost | null {
  const content = extractContent(parts);
  if (!content) return null;
  const { postId, postUrl } = extractPermalink(parts, context.groupId);
  return {
    postId,
    postUrl,
    groupId: context.groupId,
    author: extractAuthor(parts),
    content,
    publishedAt: extractPublishedAt(parts, context.capturedAt),
    capturedAt: context.capturedAt.toISOString(),
  };
}
