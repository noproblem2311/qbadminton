import { useEffect, useState } from 'react';
import { addDays } from '../lib/format';
import { EMPTY_FILTERS, LEVEL_OPTIONS, type LevelCode, type SessionFilters as Filters } from '../types/session';

interface SessionFiltersProps {
  value: Filters;
  onChange: (next: Filters) => void;
  today: string;
}

const TEXT_DEBOUNCE_MS = 400;

/** 00:00 … 23:45 every 15 minutes, shown in 24-hour format regardless of browser locale. */
const TIME_OPTIONS = Array.from(
  { length: 96 },
  (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
);

/** Keep an off-grid value (e.g. from a shared URL) selectable. */
const timeOptionsWith = (current: string) =>
  current && !TIME_OPTIONS.includes(current) ? [...TIME_OPTIONS, current].sort() : TIME_OPTIONS;

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active
      ? 'bg-emerald-700 text-white'
      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'
  }`;

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none dark:border-slate-700 dark:bg-slate-900';

export function SessionFilters({ value, onChange, today }: SessionFiltersProps) {
  // The location field updates locally and is applied after a short pause in typing.
  const [location, setLocation] = useState(value.location);

  useEffect(() => setLocation(value.location), [value.location]);

  useEffect(() => {
    if (location === value.location) return;
    const timer = window.setTimeout(() => onChange({ ...value, location: location.trim() }), TEXT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [location, value, onChange]);

  const tomorrow = addDays(today, 1);
  const hasFilters = Boolean(value.date || value.levels.length || value.location || value.timeFrom || value.timeTo);
  const hasTime = Boolean(value.timeFrom || value.timeTo);
  const crossesMidnight = Boolean(value.timeFrom && value.timeTo && value.timeFrom > value.timeTo);
  const setDate = (date: string) => onChange({ ...value, date });
  const toggleLevel = (code: LevelCode) => {
    const selected = value.levels.includes(code)
      ? value.levels.filter((level) => level !== code)
      : [...value.levels, code];
    // Keep the canonical weakest-first order.
    onChange({ ...value, levels: LEVEL_OPTIONS.map((o) => o.code).filter((c) => selected.includes(c)) });
  };

  return (
    <form
      role="search"
      aria-label="Lọc kèo"
      onSubmit={(event) => event.preventDefault()}
      className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4 dark:bg-slate-900 dark:ring-slate-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chipClass(!value.date)} onClick={() => setDate('')}>
          Tất cả
        </button>
        <button type="button" className={chipClass(value.date === today)} onClick={() => setDate(today)}>
          Hôm nay
        </button>
        <button type="button" className={chipClass(value.date === tomorrow)} onClick={() => setDate(tomorrow)}>
          Ngày mai
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm whitespace-nowrap text-slate-600 dark:text-slate-400">
          <span className="hidden sm:inline" aria-hidden>
            Ngày chơi
          </span>
          <input
            type="date"
            aria-label="Ngày chơi"
            min={today}
            value={value.date}
            onChange={(event) => setDate(event.target.value)}
            className={`${inputClass} w-auto py-1.5`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trình độ">
        <span className="mr-1 text-sm text-slate-600 dark:text-slate-400">Trình độ</span>
        {LEVEL_OPTIONS.map((option) => {
          const active = value.levels.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              title={option.name}
              aria-label={option.name}
              aria-pressed={active}
              onClick={() => toggleLevel(option.code)}
              className={chipClass(active)}
            >
              {option.short}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Khung giờ bắt đầu">
        <span className="mr-1 text-sm text-slate-600 dark:text-slate-400">Khung giờ</span>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
          Từ
          <select
            aria-label="Bắt đầu từ"
            value={value.timeFrom}
            onChange={(event) => onChange({ ...value, timeFrom: event.target.value })}
            className={`${inputClass} w-auto py-1.5 tabular-nums`}
          >
            <option value="">--:--</option>
            {timeOptionsWith(value.timeFrom).map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
          Đến
          <select
            aria-label="Bắt đầu đến"
            value={value.timeTo}
            onChange={(event) => onChange({ ...value, timeTo: event.target.value })}
            className={`${inputClass} w-auto py-1.5 tabular-nums`}
          >
            <option value="">--:--</option>
            {timeOptionsWith(value.timeTo).map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        {hasTime && (
          <button
            type="button"
            onClick={() => onChange({ ...value, timeFrom: '', timeTo: '' })}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Bỏ chọn giờ
          </button>
        )}
        {crossesMidnight && <span className="text-xs text-slate-500">(qua nửa đêm)</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="sr-only">Địa điểm</span>
          <input
            type="search"
            placeholder="Sân / địa điểm (VD: Tuyên Sơn)"
            aria-label="Địa điểm"
            value={location}
            maxLength={100}
            onChange={(event) => setLocation(event.target.value)}
            className={inputClass}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
    </form>
  );
}
