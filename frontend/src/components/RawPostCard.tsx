import { useState } from 'react';
import { formatDateTime } from '../lib/format';
import type { ProcessingStatus, RawPost } from '../types/rawPost';
import { ExternalIcon } from './icons';

export const STATUS_LABELS: Record<ProcessingStatus, string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  parsed: 'Đã phân tích',
  duplicate: 'Trùng',
  irrelevant: 'Không liên quan',
  failed: 'Lỗi',
};

const STATUS_STYLES: Record<ProcessingStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  parsed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  duplicate: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  irrelevant: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};

export function RawPostCard({ post }: { post: RawPost }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = post.content.length > 280 || post.content.split('\n').length > 5;

  return (
    <article
      aria-label={`Bài của ${post.author ?? 'không rõ người đăng'}`}
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[post.processingStatus]}`}>
          {STATUS_LABELS[post.processingStatus]}
        </span>
        <span className="font-semibold">{post.author ?? 'Không rõ người đăng'}</span>
        <time dateTime={post.capturedAt} className="ml-auto text-xs text-slate-500">
          Thu thập {formatDateTime(post.capturedAt)}
        </time>
      </header>

      <p
        className={`mt-2 text-sm leading-relaxed break-words whitespace-pre-line text-slate-700 dark:text-slate-300 ${
          expanded ? '' : 'line-clamp-5'
        }`}
      >
        {post.content}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-slate-600 hover:underline dark:text-slate-400"
        >
          {expanded ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs sm:grid-cols-4 dark:border-slate-800">
        <div>
          <dt className="text-slate-500">Đăng lúc</dt>
          <dd>{post.publishedAt ? formatDateTime(post.publishedAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Nhóm</dt>
          <dd className="truncate">{post.groupId ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Post ID</dt>
          <dd className="truncate">
            {post.postUrl ? (
              <a
                href={post.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400"
              >
                {post.facebookPostId ?? 'Mở bài'}
                <ExternalIcon className="size-3" />
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Xử lý / Kèo</dt>
          <dd>
            {post.processingAttempts} lần · {post.sessionCount} kèo
          </dd>
        </div>
      </dl>

      {post.processingStatus === 'duplicate' && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Trùng người đăng, trình độ, địa điểm và thời gian với một bài đã lưu trước đó{post.duplicateOfPostId ? '' : ' (bài gốc đã bị dọn)'}, nên không tạo thêm kèo.
        </p>
      )}

      {post.skipReason && (
        <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Bỏ qua, không gửi AI: {post.skipReason}
        </p>
      )}

      {post.lastError && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs break-words text-red-800 dark:bg-red-950/40 dark:text-red-300">
          {post.lastError}
        </p>
      )}
    </article>
  );
}
