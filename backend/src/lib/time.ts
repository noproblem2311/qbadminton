export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** Vietnam has not observed DST since 1975, so the offset is fixed. */
export const APP_UTC_OFFSET = '+07:00';

const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const WEEKDAY_SHORT_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface LocalDateTime {
  /** YYYY-MM-DD in Asia/Ho_Chi_Minh. */
  date: string;
  /** HH:mm in Asia/Ho_Chi_Minh. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export function toLocalDateTime(instant: Date): LocalDateTime {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: weekdayOf(date) };
}

export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayLabel(weekday: number): string {
  return `${WEEKDAYS_VI[weekday]} (${WEEKDAY_SHORT_VI[weekday]})`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return HH_MM.test(value);
}

/**
 * Normalize loosely formatted Vietnamese times to HH:mm.
 * Accepts "19:00", "19:00:00", "7:30", "19h", "19h30", "19g30", "19H".
 */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\s*(\d{1,2})\s*(?::|h|g|giờ)?\s*(\d{1,2})?(?::\d{2})?\s*$/iu.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Combine a local play date and start time into an absolute instant. */
export function toStartsAt(playDate: string | null, startTime: string | null): Date | null {
  if (!playDate || !startTime || !isValidIsoDate(playDate) || !isValidTime(startTime)) {
    return null;
  }
  return new Date(`${playDate}T${startTime}:00${APP_UTC_OFFSET}`);
}
