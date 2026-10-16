import { createHash } from 'node:crypto';

const SEE_MORE_SUFFIX = /(?:…|\.\.\.)?\s*(?:Xem thêm|See more)\s*$/iu;

/** Canonical form of post text used for fingerprinting (not for display). */
export function normalizeForFingerprint(value: string): string {
  return value
    .normalize('NFC')
    .replace(SEE_MORE_SUFFIX, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function computeFingerprint(input: {
  groupId: string | null;
  author: string | null;
  content: string;
}): string {
  const material = [
    input.groupId ?? '',
    normalizeForFingerprint(input.author ?? ''),
    normalizeForFingerprint(input.content),
  ].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

/** Lowercase, strip Vietnamese diacritics and collapse whitespace for search. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'd')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Escape LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/** Collapse runs of blank lines and trailing spaces while preserving line breaks. */
export function tidyContent(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
