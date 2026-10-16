import type { Session } from '../types/session';

export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** YYYY-MM-DD of an instant, in Vietnam time. */
export function localDate(instantMs: number): string {
  return dateFormatter.format(new Date(instantMs));
}

export function addDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatClock(instantMs: number): string {
  return clockFormatter.format(new Date(instantMs));
}

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hourCycle: 'h23',
});

/** "11:27 15/10/2026" in Vietnam time. */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso)).replace(',', '');
}

/** "Thứ Năm, 15/10/2026" */
export function formatFullDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const weekday = WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${day}/${month}/${year}`;
}

/** "Hôm nay" / "Ngày mai" / null */
export function relativeDayLabel(isoDate: string, todayIso: string): string | null {
  if (isoDate === todayIso) return 'Hôm nay';
  if (isoDate === addDays(todayIso, 1)) return 'Ngày mai';
  return null;
}

export function formatTimeRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} – ${end}`;
  return start ?? 'Chưa rõ giờ';
}

/** "Bắt đầu sau 25 phút" for sessions within the next 24 hours. */
export function formatCountdown(startsAtMs: number, nowMs: number): string | null {
  const minutes = Math.round((startsAtMs - nowMs) / 60_000);
  if (minutes <= 0) return 'Sắp bắt đầu';
  if (minutes < 60) return `Bắt đầu sau ${minutes} phút`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `Bắt đầu sau ${hours} giờ${rest ? ` ${rest} phút` : ''}`;
  }
  return null;
}

export const startsAtMs = (session: Session) =>
  session.startsAt ? Date.parse(session.startsAt) : Number.NaN;

/** Defensive client-side ordering; the API already returns nearest-first. */
export function sortChronologically(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => startsAtMs(a) - startsAtMs(b));
}

export interface DayGroup {
  date: string;
  sessions: Session[];
}

export function groupByDay(sessions: Session[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const session of sortChronologically(sessions)) {
    const date = session.playDate ?? (session.startsAt ? localDate(Date.parse(session.startsAt)) : '');
    const last = groups.at(-1);
    if (last && last.date === date) last.sessions.push(session);
    else groups.push({ date, sessions: [session] });
  }
  return groups;
}
