export type LevelCode = 'YEU' | 'TBY' | 'TB_MINUS' | 'TB' | 'TB_PLUS' | 'KHA';

/** The six levels, weakest first. Mirrors the backend skill_levels table. */
export const LEVEL_OPTIONS: ReadonlyArray<{ code: LevelCode; name: string; short: string }> = [
  { code: 'YEU', name: 'Yếu', short: 'Yếu' },
  { code: 'TBY', name: 'Trung bình yếu', short: 'TBY' },
  { code: 'TB_MINUS', name: 'Trung bình -', short: 'TB-' },
  { code: 'TB', name: 'Trung bình', short: 'TB' },
  { code: 'TB_PLUS', name: 'Trung bình +', short: 'TB+' },
  { code: 'KHA', name: 'Khá', short: 'Khá' },
];

export const LEVEL_CODES = LEVEL_OPTIONS.map((option) => option.code);

export interface Session {
  id: string;
  author: string | null;
  /** YYYY-MM-DD, Asia/Ho_Chi_Minh. */
  playDate: string | null;
  /** HH:mm */
  startTime: string | null;
  endTime: string | null;
  /** Level phrase as written in the post. */
  level: string | null;
  /** Normalized levels, weakest first. */
  levels: Array<{ code: LevelCode; name: string }>;
  location: string | null;
  content: string;
  postUrl: string | null;
  /** ISO instant of the start; null when date or time is unknown. */
  startsAt: string | null;
  createdAt: string;
}

/** Empty values mean "no filter". */
export interface SessionFilters {
  date: string;
  /** Sessions asking for any of these levels. */
  levels: LevelCode[];
  location: string;
  /** HH:mm, inclusive window on the start time. */
  timeFrom: string;
  timeTo: string;
}

export const EMPTY_FILTERS: SessionFilters = { date: '', levels: [], location: '', timeFrom: '', timeTo: '' };

export interface SessionsResult {
  sessions: Session[];
  serverTime: string;
}
