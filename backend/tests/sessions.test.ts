import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { addDays, toLocalDateTime } from '../src/lib/time.js';
import { SessionsRepository } from '../src/modules/sessions/sessions.repository.js';
import { insertSession } from './helpers/factories.js';
import { TEST_API_KEY, createTestDatabase } from './helpers/test-db.js';

describe('sessions', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let repository: SessionsRepository;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new SessionsRepository(testDb.db);
    app = buildApp({ db: testDb.db, ingestApiKey: TEST_API_KEY });
  });
  beforeEach(() => testDb.reset());
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const defaults = { limit: 100, offset: 0 };

  describe('upcoming filter (repository, fixed clock)', () => {
    // 2026-10-15 18:00 in Asia/Ho_Chi_Minh.
    const now = new Date('2026-10-15T18:00:00+07:00');

    it('compares full date and time and sorts ascending', async () => {
      await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '08:00', location: 'tomorrow 08:00' });
      await insertSession(testDb.db, { playDate: '2026-10-15', startTime: '19:00', location: 'today 19:00' });
      await insertSession(testDb.db, { playDate: '2026-10-15', startTime: '17:00', location: 'today 17:00' });
      await insertSession(testDb.db, { playDate: '2026-10-15', startTime: '18:00', location: 'today 18:00' });
      await insertSession(testDb.db, { playDate: '2026-10-14', startTime: '20:00', location: 'yesterday' });

      const rows = await repository.listUpcoming(defaults, now);
      expect(rows.map((row) => row.session.location)).toEqual(['today 18:00', 'today 19:00', 'tomorrow 08:00']);
    });

    it('excludes sessions with a missing date or start time', async () => {
      await insertSession(testDb.db, { playDate: '2026-10-20', startTime: null });
      await insertSession(testDb.db, { playDate: null, startTime: '19:00' });
      expect(await repository.listUpcoming(defaults, now)).toHaveLength(0);
    });

    it('filters by date, level and location (accent-insensitive)', async () => {
      await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '19:00', level: 'TB+', location: 'Sân Tuyên Sơn' });
      await insertSession(testDb.db, { playDate: '2026-10-17', startTime: '19:00', level: 'Khá', location: 'Sân Chi Lăng' });

      const byDate = await repository.listUpcoming({ ...defaults, date: '2026-10-17' }, now);
      expect(byDate.map((row) => row.session.location)).toEqual(['Sân Chi Lăng']);

      const byLevel = await repository.listUpcoming({ ...defaults, levels: ['TB_PLUS'] }, now);
      expect(byLevel.map((row) => row.session.level)).toEqual(['TB+']);

      // "TB" does not match "TB+": the six levels are distinct.
      expect(await repository.listUpcoming({ ...defaults, levels: ['TB'] }, now)).toHaveLength(0);

      const byLocation = await repository.listUpcoming({ ...defaults, location: 'tuyen son' }, now);
      expect(byLocation.map((row) => row.session.location)).toEqual(['Sân Tuyên Sơn']);

      const wildcard = await repository.listUpcoming({ ...defaults, location: '%' }, now);
      expect(wildcard).toHaveLength(0);
    });

    it('attaches every normalized level and matches any selected level', async () => {
      await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '19:00', level: 'Nữ Y+, Nam TBY TB-', location: 'A' });
      await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '20:00', level: 'TB-TB+', location: 'B' });
      await insertSession(testDb.db, { playDate: '2026-10-16', startTime: '21:00', level: null, location: 'C' });

      const all = await repository.listUpcoming(defaults, now);
      expect(all.map((row) => [row.session.location, row.levels.sort()])).toEqual([
        ['A', ['TBY', 'TB_MINUS', 'YEU'].sort()],
        ['B', ['TB_MINUS', 'TB_PLUS'].sort()],
        ['C', []],
      ]);

      const multi = await repository.listUpcoming({ ...defaults, levels: ['YEU', 'TB_PLUS'] }, now);
      expect(multi.map((row) => row.session.location)).toEqual(['A', 'B']);
      // Ranges are not expanded: "TB-TB+" does not ask for plain TB.
      expect(await repository.listUpcoming({ ...defaults, levels: ['TB'] }, now)).toHaveLength(0);
    });

    it('filters by a start-time window (inclusive, one-sided, across midnight)', async () => {
      for (const [startTime, location] of [
        ['18:00', '18:00'],
        ['19:00', '19:00'],
        ['19:30', '19:30'],
        ['21:00', '21:00'],
        ['23:30', '23:30'],
      ] as const) {
        await insertSession(testDb.db, { playDate: '2026-10-16', startTime, location });
      }
      await insertSession(testDb.db, { playDate: '2026-10-17', startTime: '00:30', location: '00:30' });
      const at = async (window: { timeFrom?: string; timeTo?: string }) =>
        (await repository.listUpcoming({ ...defaults, ...window }, now)).map((row) => row.session.location);

      expect(await at({ timeFrom: '19:00', timeTo: '21:00' })).toEqual(['19:00', '19:30', '21:00']);
      expect(await at({ timeFrom: '19:15', timeTo: '19:45' })).toEqual(['19:30']);
      expect(await at({ timeFrom: '21:00' })).toEqual(['21:00', '23:30']);
      expect(await at({ timeTo: '18:59' })).toEqual(['18:00', '00:30']);
      expect(await at({ timeTo: '17:59' })).toEqual(['00:30']);
      expect(await at({ timeFrom: '23:00', timeTo: '01:00' })).toEqual(['23:30', '00:30']);
    });

    it('keeps expired sessions in the database', async () => {
      const old = await insertSession(testDb.db, { playDate: '2026-10-10', startTime: '19:00' });
      expect(await repository.listUpcoming(defaults, now)).toHaveLength(0);
      expect(await repository.findById(old.id)).toBeDefined();
    });
  });

  describe('HTTP API (database clock)', () => {
    const today = () => toLocalDateTime(new Date()).date;

    it('GET /api/v1/sessions returns only upcoming sessions, nearest first', async () => {
      await insertSession(testDb.db, { playDate: addDays(today(), 2), startTime: '08:00', location: 'later' });
      await insertSession(testDb.db, { playDate: addDays(today(), 1), startTime: '20:00', endTime: '22:00', level: 'TB', location: 'sooner' });
      await insertSession(testDb.db, { playDate: addDays(today(), -1), startTime: '20:00', location: 'expired' });

      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.meta).toMatchObject({ count: 2, limit: 100, offset: 0 });
      expect(Date.parse(body.meta.serverTime)).not.toBeNaN();
      expect(body.data.map((s: { location: string }) => s.location)).toEqual(['sooner', 'later']);
      expect(body.data[0]).toMatchObject({
        author: 'Trần Thị B',
        startTime: '20:00',
        endTime: '22:00',
        level: 'TB',
        levels: [{ code: 'TB', name: 'Trung bình' }],
        postUrl: expect.stringMatching(/^https:\/\/www\.facebook\.com\/groups\/caulongdanang\/posts\/\d+\/$/u),
      });

      const filtered = await app.inject({ method: 'GET', url: '/api/v1/sessions?level=TB,KHA' });
      expect(filtered.json().data.map((s: { location: string }) => s.location)).toEqual(['sooner']);

      const morning = await app.inject({ method: 'GET', url: '/api/v1/sessions?timeFrom=06:00&timeTo=09:00' });
      expect(morning.json().data.map((s: { location: string }) => s.location)).toEqual(['later']);
    });

    it('validates query parameters', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/sessions?date=15-10-2026' });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');

      const badLevel = await app.inject({ method: 'GET', url: '/api/v1/sessions?level=GIOI' });
      expect(badLevel.statusCode).toBe(400);

      for (const query of ['timeFrom=25:00', 'timeTo=7h', 'timeFrom=19:5']) {
        expect((await app.inject({ method: 'GET', url: `/api/v1/sessions?${query}` })).statusCode).toBe(400);
      }
    });

    it('GET /api/v1/sessions/:id returns a session or 404', async () => {
      const session = await insertSession(testDb.db, { playDate: addDays(today(), 1), startTime: '19:00' });
      const found = await app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}` });
      expect(found.statusCode).toBe(200);
      expect(found.json().data.id).toBe(session.id);

      const missing = await app.inject({ method: 'GET', url: '/api/v1/sessions/00000000-0000-4000-8000-000000000000' });
      expect(missing.statusCode).toBe(404);
      const invalid = await app.inject({ method: 'GET', url: '/api/v1/sessions/not-a-uuid' });
      expect(invalid.statusCode).toBe(404);
    });

    it('GET /health reports database status', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', database: 'ok' });
    });

    it('unknown routes return a JSON 404', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });
  });
});
