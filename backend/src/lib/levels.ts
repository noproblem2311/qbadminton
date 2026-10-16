import type { LevelCode } from '../database/schema.js';

/** The six skill levels, weakest first. Mirrors the skill_levels table seed. */
export const LEVELS: ReadonlyArray<{ code: LevelCode; name: string; sortOrder: number }> = [
  { code: 'YEU', name: 'Yếu', sortOrder: 1 },
  { code: 'TBY', name: 'Trung bình yếu', sortOrder: 2 },
  { code: 'TB_MINUS', name: 'Trung bình -', sortOrder: 3 },
  { code: 'TB', name: 'Trung bình', sortOrder: 4 },
  { code: 'TB_PLUS', name: 'Trung bình +', sortOrder: 5 },
  { code: 'KHA', name: 'Khá', sortOrder: 6 },
];

const LEVEL_NAME = new Map(LEVELS.map((level) => [level.code, level.name]));
const LEVEL_ORDER = new Map(LEVELS.map((level) => [level.code, level.sortOrder]));

export const levelName = (code: LevelCode) => LEVEL_NAME.get(code) ?? code;

export function sortLevels(codes: Iterable<LevelCode>): LevelCode[] {
  return [...new Set(codes)].sort((a, b) => (LEVEL_ORDER.get(a) ?? 0) - (LEVEL_ORDER.get(b) ?? 0));
}

// Level words, longest alternatives first. Matched on lowercase text without diacritics.
const LEVEL_WORD = String.raw`(trung binh (?:yeu|kha|nhinh)|trung binh|tb ?(?:yeu|kha|nhinh)|tby|tbk|tb|moi choi|newbie|yeu|kha|gioi|y|k)`;
const TOKEN = new RegExp(String.raw`(?<![a-z0-9])${LEVEL_WORD}(?![a-z])`, 'gu');
const STARTS_WITH_TOKEN = new RegExp(String.raw`^\s*${LEVEL_WORD}(?![a-z])`, 'u');
const ALL_LEVELS = /\b(?:moi trinh(?: do)?|tat ca trinh(?: do)?|all levels?)\b/u;

function toCode(word: string, signs: string): LevelCode {
  const w = word.replace(/\s+/gu, ' ');
  if (/^(?:yeu|y|moi choi|newbie)$/u.test(w)) return 'YEU';
  if (/^(?:tby|tb ?yeu|trung binh yeu)$/u.test(w)) return 'TBY';
  if (/^(?:tbk|tb ?kha|trung binh kha)$/u.test(w)) return 'TB_PLUS';
  if (/^(?:kha|k|gioi)$/u.test(w)) return 'KHA';
  // tb / trung binh / tb nhinh: the signs decide.
  const plus = signs.includes('+');
  const minus = signs.includes('-');
  if (minus && !plus) return 'TB_MINUS';
  if (plus && !minus) return 'TB_PLUS';
  return 'TB';
}

/**
 * Map a free-text level phrase ("Nữ Y+, Nam TBY TB-", "Tb, tb +") to the six levels.
 * Only levels that are actually written are returned; ranges are not expanded.
 *   Y / Yếu with any signs        → YEU
 *   TBY / trung bình yếu (+ signs) → TBY
 *   TB- (one or more -)           → TB_MINUS
 *   TB / trung bình / TB nhỉnh    → TB
 *   TB+ (one or more +), TBK      → TB_PLUS
 *   Khá / K with any signs        → KHA
 */
export function normalizeLevels(text: string | null | undefined): LevelCode[] {
  if (!text) return [];
  const s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gu, 'd');
  if (ALL_LEVELS.test(s)) return LEVELS.map((level) => level.code);

  const codes: LevelCode[] = [];
  for (const match of s.matchAll(TOKEN)) {
    const rest = s.slice((match.index ?? 0) + match[0].length);
    let signs = /^[+-]+/u.exec(rest)?.[0] ?? '';
    if (!signs) {
      // "tb +" is a sign; in "TB - Khá" the dash separates two levels.
      const spaced = /^\s+([+-]+)/u.exec(rest);
      if (spaced?.[1] && !STARTS_WITH_TOKEN.test(rest.slice(spaced[0].length))) signs = spaced[1];
    }
    codes.push(toCode(match[1] ?? '', signs));
  }
  return sortLevels(codes);
}
