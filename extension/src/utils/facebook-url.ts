const FACEBOOK_HOST = /(^|\.)facebook\.com$/iu;
const GROUP_PATH = /^\/groups\/([A-Za-z0-9_.-]{1,128})(?:\/|$)/u;
/** Paths under /groups/ that are Facebook pages, not groups. */
const NON_GROUP_SEGMENTS = new Set(['feed', 'discover', 'joins', 'create', 'search', 'notifications', 'you']);
const POST_ID = String.raw`(\d{5,25}|pfbid[A-Za-z0-9]{10,})`;
const GROUP_POST_PATH = new RegExp(String.raw`^/groups/([A-Za-z0-9_.-]{1,128})/(?:posts|permalink)/${POST_ID}(?:/|$)`, 'u');
const PROFILE_POST_PATH = new RegExp(String.raw`^/[A-Za-z0-9_.-]{1,128}/posts/${POST_ID}(?:/|$)`, 'u');
const POST_ID_ONLY = new RegExp(`^${POST_ID}$`, 'u');

export const isFacebookHost = (hostname: string) => FACEBOOK_HOST.test(hostname);

function toUrl(href: string, base = 'https://www.facebook.com/'): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** Group ID or vanity name from a group page URL, e.g. /groups/caulongdanang/. */
export function parseGroupId(href: string | null | undefined): string | null {
  if (!href) return null;
  const url = toUrl(href);
  if (!url || !isFacebookHost(url.hostname)) return null;
  const match = GROUP_PATH.exec(url.pathname);
  const groupId = match?.[1];
  if (!groupId || NON_GROUP_SEGMENTS.has(groupId.toLowerCase())) return null;
  return groupId;
}

export const groupUrl = (groupId: string) => `https://www.facebook.com/groups/${groupId}/`;

/** Tracking-free permalink. */
export function canonicalPostUrl(groupId: string | null, postId: string): string {
  return groupId
    ? `https://www.facebook.com/groups/${groupId}/posts/${postId}/`
    : `https://www.facebook.com/${postId}`;
}

export interface PostLink {
  postId: string;
  groupId: string | null;
}

/**
 * Recognize links that point at a post. Links to a comment (comment_id /
 * reply_comment_id) are rejected so comment permalinks are never mistaken for posts.
 */
export function parsePostLink(href: string | null | undefined): PostLink | null {
  if (!href || href.startsWith('#')) return null;
  const url = toUrl(href);
  if (!url || !isFacebookHost(url.hostname)) return null;
  if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return null;

  const groupPost = GROUP_POST_PATH.exec(url.pathname);
  if (groupPost?.[1] && groupPost[2]) return { groupId: groupPost[1], postId: groupPost[2] };

  const story = url.searchParams.get('story_fbid');
  if (story && POST_ID_ONLY.test(story)) return { groupId: null, postId: story };

  const multi = url.searchParams.get('multi_permalinks');
  if (multi && /^\d{5,25}$/u.test(multi)) return { groupId: parseGroupId(url.href), postId: multi };

  // Group photo links carry the post ID: /photo/?fbid=<photo>&set=gm.<post>&idorvanity=<group>
  const groupMedia = /^gm\.(\d{5,25})$/u.exec(url.searchParams.get('set') ?? '');
  if (groupMedia?.[1]) {
    const group = url.searchParams.get('idorvanity');
    return { groupId: group && /^[A-Za-z0-9_.-]{1,128}$/u.test(group) ? group : null, postId: groupMedia[1] };
  }

  const profilePost = PROFILE_POST_PATH.exec(url.pathname);
  if (profilePost?.[1]) return { groupId: null, postId: profilePost[1] };

  return null;
}
