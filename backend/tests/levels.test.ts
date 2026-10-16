import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skillLevels } from '../src/database/schema.js';
import { LEVELS, normalizeLevels } from '../src/lib/levels.js';
import { createTestDatabase } from './helpers/test-db.js';

describe('normalizeLevels', () => {
  it.each([
    // Yếu: Y / Yếu with any number of + or -
    ['Y', ['YEU']],
    ['Yếu', ['YEU']],
    ['Yếu-', ['YEU']],
    ['Yếu+', ['YEU']],
    ['Yếu++', ['YEU']],
    ['Y--', ['YEU']],
    ['Mới chơi', ['YEU']],
    // Trung bình yếu (any signs)
    ['TBY', ['TBY']],
    ['TBY+', ['TBY']],
    ['tby-', ['TBY']],
    ['Trung bình yếu', ['TBY']],
    // Trung bình -: one or more minus
    ['TB-', ['TB_MINUS']],
    ['tb--', ['TB_MINUS']],
    ['Trung bình -', ['TB_MINUS']],
    // Trung bình, trung bình nhỉnh
    ['TB', ['TB']],
    ['Trung bình', ['TB']],
    ['trung bình nhỉnh', ['TB']],
    ['TB nhỉnh', ['TB']],
    // Trung bình +: one or more plus
    ['TB+', ['TB_PLUS']],
    ['tb++', ['TB_PLUS']],
    ['Trung bình +', ['TB_PLUS']],
    ['TBK', ['TB_PLUS']],
    // Khá with any signs
    ['Khá', ['KHA']],
    ['Khá+', ['KHA']],
    ['khá--', ['KHA']],
    ['K', ['KHA']],
  ])('%s → %j', (text, expected) => {
    expect(normalizeLevels(text)).toEqual(expected);
  });

  it.each([
    ['Nữ Y+, Nam TBY TB-', ['YEU', 'TBY', 'TB_MINUS']],
    ['Tb, tb +', ['TB', 'TB_PLUS']],
    ['Nam,Nữ : TB-/TB', ['TB_MINUS', 'TB']],
    ['Nam Yếu+ ➡️ TBY+ | NỮ Yếu ➡️ TBY', ['YEU', 'TBY']],
    ['TB - Khá', ['TB', 'KHA']],
  ])('collects every written level: %s', (text, expected) => {
    expect(normalizeLevels(text)).toEqual(expected);
  });

  it('does not expand ranges', () => {
    expect(normalizeLevels('TB-TB+')).toEqual(['TB_MINUS', 'TB_PLUS']);
    expect(normalizeLevels('Y đến TB')).toEqual(['YEU', 'TB']);
  });

  it('maps "mọi trình độ" to all six levels and ignores non-level text', () => {
    expect(normalizeLevels('Mọi trình độ')).toEqual(LEVELS.map((level) => level.code));
    expect(normalizeLevels('Phí 45k')).toEqual([]);
    expect(normalizeLevels('')).toEqual([]);
    expect(normalizeLevels(null)).toEqual([]);
  });
});

describe('skill_levels table', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    testDb = await createTestDatabase();
  });
  afterAll(() => testDb.close());

  it('is seeded with exactly the six levels', async () => {
    const rows = await testDb.db.select().from(skillLevels).orderBy(skillLevels.sortOrder);
    expect(rows).toEqual(LEVELS.map(({ code, name, sortOrder }) => ({ code, name, sortOrder })));
  });

  it('rejects any other level code', async () => {
    await expect(
      testDb.db.execute(sql`insert into skill_levels (code, name, sort_order) values ('GIOI', 'Giỏi', 7)`),
    ).rejects.toThrow();
  });
});
