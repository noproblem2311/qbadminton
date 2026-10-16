import { isUiLabel, precedes, textOf } from './dom.utils';

/*
 * Facebook group feed structure (observed; class names are generated and unstable):
 *
 *   [role="feed"]
 *     > div              one child per feed item: posts, but also sorting controls,
 *                        loading skeletons and virtualized placeholders
 *         [data-virtualized="false"]   rendered content (placeholders are emptied)
 *           h2 > … > a                 author header
 *           [data-ad-preview="message"] post text (when present)
 *           [role="article"]           COMMENTS (and replies) — not the post itself
 *
 * Detection therefore relies on structure and semantics, never on class names, and
 * treats every [role="article"] other than the one wrapping the author header as a
 * comment.
 */

const HEADING_SELECTOR = 'h2, h3, h4';
const ARTICLE_SELECTOR = '[role="article"]';
const MESSAGE_SELECTOR =
  '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"]';
const EDITOR_SELECTOR = 'form, [role="textbox"], [contenteditable="true"]';
const ACTION_LABELS = /^(?:thích|like|bình luận|comment)$/iu;

export interface PostParts {
  container: HTMLElement;
  heading: HTMLElement | null;
  /** The [role="article"] wrapping the post header, when the layout has one. */
  article: Element | null;
  message: HTMLElement | null;
  /** First Like/Comment button of the post itself; post text comes before it. */
  actionBar: Element | null;
}

/** The main group feed. With several feeds, prefer the one inside [role="main"]. */
export function findFeed(root: ParentNode = document): HTMLElement | null {
  const feeds = Array.from(root.querySelectorAll<HTMLElement>('[role="feed"]'));
  if (feeds.length <= 1) return feeds[0] ?? null;
  const inMain = feeds.filter((feed) => feed.closest('[role="main"]'));
  const pool = inMain.length > 0 ? inMain : feeds;
  return pool.reduce((best, feed) => (feed.childElementCount > best.childElementCount ? feed : best));
}

export function getCandidateContainers(feed: Element): HTMLElement[] {
  return Array.from(feed.children) as HTMLElement[];
}

function articleDepth(node: Element, container: Element): number {
  let depth = 0;
  for (let el: Element | null = node.parentElement; el; el = el.parentElement) {
    if (el.getAttribute('role') === 'article') depth += 1;
    if (el === container) break;
  }
  return depth;
}

/**
 * The post's author header: the heading inside Facebook's profile_name block when
 * present, otherwise the first non-empty heading in document order that is not inside
 * a nested (comment) article or a button (e.g. the "Bài viết mới" sort control).
 */
export function findAuthorHeading(container: Element): HTMLElement | null {
  const isCandidate = (heading: HTMLElement) =>
    Boolean(textOf(heading)) && articleDepth(heading, container) < 2 && !heading.closest('[role="button"]');

  for (const profile of container.querySelectorAll('[data-ad-rendering-role="profile_name"]')) {
    const heading = profile.querySelector<HTMLElement>(HEADING_SELECTOR);
    if (heading && isCandidate(heading)) return heading;
  }
  for (const heading of container.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (isCandidate(heading)) return heading;
  }
  return null;
}

/**
 * Whether a node belongs to a comment, reply or comment composer rather than to the
 * post. Any [role="article"] inside the container other than the post's own wrapper
 * is a comment.
 */
export function isInsideComment(node: Node, parts: Pick<PostParts, 'container' | 'article'>): boolean {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element) return false;
  const editor = element.closest(EDITOR_SELECTOR);
  if (editor && parts.container.contains(editor)) return true;
  const article = element.closest(ARTICLE_SELECTOR);
  if (!article || !parts.container.contains(article)) return false;
  return article !== parts.article && article !== parts.container;
}

function findActionBar(parts: Pick<PostParts, 'container' | 'article'>): Element | null {
  for (const button of parts.container.querySelectorAll('[role="button"]')) {
    // Current Facebook renders icon-only buttons labelled via aria-label.
    const label = textOf(button) || button.getAttribute('aria-label')?.trim() || '';
    const isAction = ACTION_LABELS.test(label) || button.querySelector('[data-ad-rendering-role="like_button"]');
    if (isAction && !isInsideComment(button, parts)) return button;
  }
  return null;
}

export function analyzeContainer(container: HTMLElement): PostParts {
  const heading = findAuthorHeading(container);
  const headingArticle = heading?.closest(ARTICLE_SELECTOR) ?? null;
  const article = headingArticle && container.contains(headingArticle) ? headingArticle : null;
  const base = { container, article };

  let message: HTMLElement | null = null;
  for (const candidate of container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) {
    if (!isInsideComment(candidate, base)) {
      message = candidate;
      break;
    }
  }
  return { container, heading, article, message, actionBar: findActionBar(base) };
}

/**
 * Text blocks of the post body when Facebook omits the message marker: top-level
 * `div[dir="auto"]` elements outside the header, comments and UI chrome, located
 * before the action bar.
 */
export function findBodyBlocks(parts: PostParts): HTMLElement[] {
  const blocks = Array.from(parts.container.querySelectorAll<HTMLElement>('div[dir="auto"]')).filter((block) => {
    if (parts.heading?.contains(block) || isInsideComment(block, parts)) return false;
    if (block.closest('[role="button"]')) return false;
    if (parts.actionBar && !precedes(block, parts.actionBar)) return false;
    const text = textOf(block);
    return text.length > 0 && !isUiLabel(text);
  });
  return blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
}

/** Loading skeletons and virtualized (emptied) feed items. */
export function isPlaceholder(container: Element): boolean {
  if (container.getAttribute('aria-busy') === 'true') return true;
  if (container.matches('[data-virtualized="true"]')) return true;
  if (container.querySelector('[data-virtualized="true"]') && !container.querySelector('[data-virtualized="false"]')) {
    return true;
  }
  if (container.querySelector('[role="progressbar"]') && !container.querySelector(HEADING_SELECTOR)) return true;
  return textOf(container).length === 0;
}

export function hasPostLink(parts: PostParts, parseLink: (href: string) => unknown): boolean {
  for (const anchor of parts.container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (isInsideComment(anchor, parts) || parts.message?.contains(anchor)) continue;
    if (parseLink(anchor.getAttribute('href') ?? '')) return true;
  }
  return false;
}

/**
 * A feed child is a post when it is rendered, has an author header outside any
 * comment, and has post text or a post permalink. Sorting controls, composer
 * prompts and skeletons fail at least one of these checks.
 */
export function isPostContainer(container: HTMLElement, parseLink: (href: string) => unknown): boolean {
  if (isPlaceholder(container)) return false;
  const parts = analyzeContainer(container);
  if (!parts.heading) return false;
  return Boolean(parts.message) || findBodyBlocks(parts).length > 0 || hasPostLink(parts, parseLink);
}

export function findPostContainers(root: ParentNode, parseLink: (href: string) => unknown): HTMLElement[] {
  const feed = findFeed(root);
  if (!feed) return [];
  return getCandidateContainers(feed).filter((container) => isPostContainer(container, parseLink));
}
