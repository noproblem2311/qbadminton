import { useState } from 'react';
import { formatCountdown, formatTimeRange, startsAtMs } from '../lib/format';
import { LEVEL_OPTIONS, type Session } from '../types/session';
import { ExternalIcon, PinIcon, UserIcon } from './icons';

interface SessionCardProps {
  session: Session;
  /** Current time (server-corrected), for the countdown label. */
  now: number;
}

const LEVEL_SHORT = new Map(LEVEL_OPTIONS.map((option) => [option.code, option.short]));
const levelChipClass =
  'rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-300';

const LONG_CONTENT_CHARS = 220;
const LONG_CONTENT_LINES = 4;

export function SessionCard({ session, now }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const countdown = formatCountdown(startsAtMs(session), now);
  const timeRange = formatTimeRange(session.startTime, session.endTime);
  const isLong =
    session.content.length > LONG_CONTENT_CHARS ||
    session.content.split('\n').length > LONG_CONTENT_LINES;

  return (
    <article
      aria-label={`Kèo ${timeRange}${session.location ? ` tại ${session.location}` : ''}`}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-bold tracking-tight tabular-nums">{timeRange}</p>
          {countdown && (
            <p className="mt-0.5 text-sm font-medium whitespace-nowrap text-emerald-700 dark:text-emerald-400">
              {countdown}
            </p>
          )}
        </div>
        {(session.levels.length > 0 || session.level) && (
          <ul
            aria-label="Trình độ"
            title={session.level ? `Trình độ trong bài: ${session.level}` : undefined}
            className="flex min-w-0 flex-wrap justify-end gap-1"
          >
            {session.levels.length > 0 ? (
              session.levels.map((level) => (
                <li key={level.code} title={level.name} className={levelChipClass}>
                  {LEVEL_SHORT.get(level.code) ?? level.name}
                </li>
              ))
            ) : (
              <li className={levelChipClass}>{session.level}</li>
            )}
          </ul>
        )}
      </header>

      <dl className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        <div className="flex items-start gap-2">
          <dt className="pt-0.5">
            <PinIcon className="size-4 text-slate-400" />
            <span className="sr-only">Địa điểm</span>
          </dt>
          <dd className="font-medium">{session.location ?? 'Chưa rõ địa điểm'}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="pt-0.5">
            <UserIcon className="size-4 text-slate-400" />
            <span className="sr-only">Người đăng</span>
          </dt>
          <dd>{session.author ?? 'Không rõ người đăng'}</dd>
        </div>
      </dl>

      <div className="mt-3 flex-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p
          className={`text-[15px] leading-relaxed break-words whitespace-pre-line text-slate-600 dark:text-slate-400 ${
            expanded ? '' : 'line-clamp-4'
          }`}
        >
          {session.content}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {expanded ? 'Thu gọn' : 'Xem thêm'}
          </button>
        )}
      </div>

      {session.postUrl && (
        <a
          href={session.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400"
        >
          Xem bài gốc trên Facebook
          <ExternalIcon className="size-4" />
        </a>
      )}
    </article>
  );
}
