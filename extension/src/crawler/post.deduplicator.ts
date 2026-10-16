import type { RawFacebookPost } from '../types/post';

const TRAILING_SEE_MORE = /(?:…|\.\.\.)?\s*(?:xem thêm|see more)\s*$/iu;

function normalize(value: string): string {
  return value.normalize('NFC').replace(TRAILING_SEE_MORE, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Deterministic SHA-256 of group + author + normalized content. */
export async function computeFingerprint(post: Pick<RawFacebookPost, 'groupId' | 'author' | 'content'>): Promise<string> {
  const material = [post.groupId ?? '', normalize(post.author ?? ''), normalize(post.content)].join('\u0000');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Dedup key. The Facebook post ID and the content fingerprint live in separate
 * namespaces so one can never collide with the other.
 */
export async function postKey(post: RawFacebookPost): Promise<string> {
  return post.postId ? `id:${post.groupId ?? ''}:${post.postId}` : `fp:${await computeFingerprint(post)}`;
}

/** Per-page memory of handled DOM nodes and post keys. */
export class PostDeduplicator {
  private readonly keys = new Set<string>();
  private readonly doneElements = new WeakSet<Element>();

  isDone(element: Element): boolean {
    return this.doneElements.has(element);
  }

  markDone(element: Element): void {
    this.doneElements.add(element);
  }

  /** Returns true the first time a key is seen. */
  claim(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}
