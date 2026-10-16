const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'PRE', 'TABLE', 'TR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']);

export const SEE_MORE_LABEL = /^(?:xem thêm|see more)$/iu;
const EXPAND_COLLAPSE_LABEL = /^(?:xem thêm|see more|ẩn bớt|see less)$/iu;
const TRAILING_SEE_MORE = /\s*(?:…|\.{3})?\s*(?:xem thêm|see more)\s*$/iu;

/** Facebook chrome that must never be mistaken for post text. */
const UI_LABELS = new Set([
  'thích', 'bình luận', 'chia sẻ', 'gửi', 'like', 'comment', 'share', 'send',
  'xem thêm', 'see more', 'ẩn bớt', 'see less', 'phù hợp nhất', 'most relevant',
  'mới nhất', 'new posts', 'bài viết mới', 'hoạt động mới', 'new activity',
  'viết bình luận...', 'viết bình luận…', 'write a comment...', 'write a comment…',
  'theo dõi', 'follow', 'tham gia', 'join', 'trả lời', 'reply',
]);
const COUNTER_LABEL = /^\d+(?:[.,]\d+)?\s*(?:k\s*)?(?:bình luận|lượt chia sẻ|lượt thích|comments?|shares?|likes?)$/iu;

/** Collapse whitespace; for quick comparisons, not for preserving layout. */
export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

export function isUiLabel(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return UI_LABELS.has(normalized) || COUNTER_LABEL.test(normalized);
}

export function tidyText(value: string): string {
  return value
    .replace(/ /gu, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .replace(TRAILING_SEE_MORE, '')
    .trim();
}

/**
 * innerText-like extraction that does not depend on layout (works in jsdom too):
 * block elements and <br> become line breaks, emoji <img> contribute their alt
 * text, and "Xem thêm"/"See more" toggles are dropped.
 */
export function extractText(root: Element): string {
  const BLOCK_BREAK = '\u0001';
  const parts: string[] = [];
  let truncated = false;
  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag) || element.hidden || element.style?.display === 'none') return;
    if (element.getAttribute('role') === 'button' && EXPAND_COLLAPSE_LABEL.test(textOf(element))) {
      truncated = true;
      return;
    }
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    if (tag === 'IMG') {
      parts.push(element.getAttribute('alt') ?? '');
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push(BLOCK_BREAK);
    element.childNodes.forEach(walk);
    if (block) parts.push(BLOCK_BREAK);
  };
  walk(root);

  // Adjacent block boundaries collapse into one line break, merging with a <br> next to them.
  let text = parts
    .join('')
    .replace(/\u0001(?:\s*\u0001)+/gu, BLOCK_BREAK)
    .replace(/\n?\u0001\n?/gu, '\n');
  text = tidyText(text);
  // Facebook's truncation ellipsis is not part of the post.
  return truncated ? text.replace(/\s*(?:…|\.{3})$/u, '') : text;
}

/** True when `a` comes before `b` in document order. */
export function precedes(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */);
}
