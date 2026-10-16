export function LoadingState() {
  return (
    <div role="status" aria-label="Đang tải danh sách kèo" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="h-7 w-40 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-4 h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-2 h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-6 h-16 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-4xl" aria-hidden>
        🏸
      </p>
      <h2 className="mt-3 text-lg font-semibold">
        {filtered ? 'Không có kèo nào khớp bộ lọc' : 'Chưa có kèo nào sắp diễn ra'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {filtered
          ? 'Thử đổi ngày, trình độ hoặc địa điểm.'
          : 'Danh sách tự cập nhật mỗi phút khi có bài tuyển mới.'}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Xóa bộ lọc
        </button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900 dark:bg-red-950/40"
    >
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">Không tải được danh sách kèo</h2>
      <p className="mt-1 text-sm text-red-700 dark:text-red-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
      >
        Thử lại
      </button>
    </div>
  );
}
