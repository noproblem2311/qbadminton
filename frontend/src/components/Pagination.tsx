interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export type PageItem = number | 'gap';

/** First, last and the pages around the current one; gaps collapse longer runs. */
export function pageItems(page: number, totalPages: number): PageItem[] {
  const wanted = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const current of wanted) {
    if (current - previous === 2) items.push(previous + 1);
    else if (current - previous > 2) items.push('gap');
    items.push(current);
    previous = current;
  }
  return items;
}

const buttonClass =
  'min-w-9 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:ring-slate-700 dark:hover:bg-slate-800';

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Trước
      </button>
      {pageItems(page, totalPages).map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="px-1 text-slate-400" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={`Trang ${item}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onChange(item)}
            className={`${buttonClass} ${item === page ? 'bg-slate-900 text-white ring-slate-900 hover:bg-slate-900 dark:bg-white dark:text-slate-900' : ''}`}
          >
            {item}
          </button>
        ),
      )}
      <button type="button" className={buttonClass} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Sau →
      </button>
    </nav>
  );
}
