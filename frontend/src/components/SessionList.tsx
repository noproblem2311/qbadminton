import { formatFullDate, groupByDay, relativeDayLabel } from '../lib/format';
import type { Session } from '../types/session';
import { SessionCard } from './SessionCard';

interface SessionListProps {
  sessions: Session[];
  now: number;
  /** Today's date (YYYY-MM-DD, Vietnam time). */
  today: string;
}

export function SessionList({ sessions, now, today }: SessionListProps) {
  return (
    <div className="space-y-8">
      {groupByDay(sessions).map((group) => {
        const relative = relativeDayLabel(group.date, today);
        const headingId = `day-${group.date}`;
        return (
          <section key={group.date} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="sticky top-0 z-10 -mx-4 mb-3 flex items-baseline gap-2 bg-slate-50/90 px-4 py-2 backdrop-blur dark:bg-slate-950/90"
            >
              {relative && (
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {relative}
                </span>
              )}
              <span className={relative ? 'text-sm text-slate-500' : 'text-lg font-bold'}>
                {group.date ? formatFullDate(group.date) : 'Chưa rõ ngày'}
              </span>
              <span className="ml-auto text-sm text-slate-500">{group.sessions.length} kèo</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.sessions.map((session) => (
                <SessionCard key={session.id} session={session} now={now} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
