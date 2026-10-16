import type { Session } from '../src/types/session';

let counter = 0;

/** A session starting `hoursFromNow` hours from the given instant (Vietnam = UTC+7). */
export function makeSession(overrides: Partial<Session> & { hoursFromNow?: number; now?: number } = {}): Session {
  counter += 1;
  const { hoursFromNow = 2, now = Date.now(), ...rest } = overrides;
  const startsAt = new Date(now + hoursFromNow * 3_600_000);
  const local = new Date(startsAt.getTime() + 7 * 3_600_000);
  const playDate = local.toISOString().slice(0, 10);
  const startTime = local.toISOString().slice(11, 16);
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    author: 'Nguyễn Văn A',
    playDate,
    startTime,
    endTime: null,
    level: 'TB+',
    levels: [{ code: 'TB_PLUS', name: 'Trung bình +' }],
    location: `Sân số ${counter}`,
    content: 'Tối nay sân Tuyên Sơn thiếu 2 nam trình TB+, 19h-21h, ai giao lưu được thì ib mình.',
    postUrl: `https://www.facebook.com/groups/caulong/posts/${counter}/`,
    startsAt: startsAt.toISOString(),
    createdAt: new Date(now).toISOString(),
    ...rest,
  };
}

export function sessionsResponse(sessions: Session[], serverTime = new Date().toISOString()) {
  return new Response(
    JSON.stringify({ success: true, data: sessions, meta: { count: sessions.length, limit: 200, offset: 0, serverTime } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
