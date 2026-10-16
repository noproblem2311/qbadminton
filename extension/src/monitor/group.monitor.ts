import { findPostContainers, analyzeContainer } from '../crawler/post.detector';
import { PostDeduplicator, postKey } from '../crawler/post.deduplicator';
import { extractPermalink, extractPost, findLazyLinks, findSeeMoreButton } from '../crawler/post.extractor';
import { FeedObserver, type FeedObserverOptions } from '../crawler/post.observer';
import type { ExtractedPost, ScanSummary } from '../types/messages';
import { parsePostLink } from '../utils/facebook-url';

export interface GroupMonitorOptions {
  doc: Document;
  /** Group of the current page (re-read on every scan for SPA navigation). */
  getGroupId: () => string | null;
  submit: (posts: ExtractedPost[]) => Promise<void>;
  onScan?: (summary: ScanSummary) => void;
  now?: () => Date;
  observer?: FeedObserverOptions;
  /** Delay before re-checking posts after expanding "Xem thêm" or hovering a timestamp. */
  lazyRetryMs?: number;
}

/**
 * Content-script side of monitoring one group tab: initial scan, MutationObserver
 * driven rescans, a single-flight scan lock, and per-page deduplication.
 */
export class GroupMonitor {
  private readonly observer: FeedObserver;
  private readonly dedup = new PostDeduplicator();
  private readonly lazyTriggered = new WeakSet<Element>();
  private active = false;
  private scanning: Promise<ScanSummary | null> | null = null;
  private rescanRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: GroupMonitorOptions) {
    this.observer = new FeedObserver(options.doc.body, () => void this.scan(), options.observer);
  }

  isActive(): boolean {
    return this.active;
  }

  start(): Promise<ScanSummary | null> {
    if (!this.active) {
      this.active = true;
      this.observer.start();
    }
    return this.scan();
  }

  stop(): void {
    this.active = false;
    this.observer.stop();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Single-flight: a scan requested while one runs is folded into one more pass. */
  scan(): Promise<ScanSummary | null> {
    if (!this.active) return Promise.resolve(null);
    if (this.scanning) {
      this.rescanRequested = true;
      return this.scanning;
    }
    this.scanning = (async () => {
      let summary: ScanSummary | null = null;
      do {
        this.rescanRequested = false;
        summary = await this.scanOnce();
      } while (this.rescanRequested && this.active);
      return summary;
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async scanOnce(): Promise<ScanSummary> {
    const now = this.options.now ?? (() => new Date());
    const groupId = this.options.getGroupId();
    const containers = findPostContainers(this.options.doc, parsePostLink);
    const fresh: ExtractedPost[] = [];
    let retryLater = false;

    for (const container of containers) {
      if (this.dedup.isDone(container)) continue;
      const parts = analyzeContainer(container);

      // Give Facebook one chance to expand truncated text / fill a lazy permalink.
      if (!this.lazyTriggered.has(container)) {
        this.lazyTriggered.add(container);
        if (this.triggerLazyContent(parts)) {
          retryLater = true;
          continue;
        }
      }

      const post = extractPost(container, { groupId, capturedAt: now() }, parts);
      if (!post) continue;
      this.dedup.markDone(container);
      const key = await postKey(post);
      if (this.dedup.claim(key)) fresh.push({ key, post });
    }

    if (retryLater) this.scheduleRetry();
    if (fresh.length > 0) await this.options.submit(fresh);

    const summary = { candidates: containers.length, extracted: fresh.length, at: now().toISOString() };
    this.options.onScan?.(summary);
    return summary;
  }

  private triggerLazyContent(parts: ReturnType<typeof analyzeContainer>): boolean {
    let triggered = false;
    const seeMore = findSeeMoreButton(parts);
    if (seeMore) {
      seeMore.click();
      triggered = true;
    }
    if (!extractPermalink(parts, null).postId) {
      // Facebook writes the real permalink into the timestamp link on hover/focus.
      // Synthetic events don't move the pointer or keyboard focus.
      for (const link of findLazyLinks(parts).slice(0, 2)) {
        link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        setTimeout(() => {
          link.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
          link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
          link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        }, 300);
        triggered = true;
      }
    }
    return triggered;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.scan();
    }, this.options.lazyRetryMs ?? 1_500);
  }
}

/** Whether reloading now would disrupt the user (typing, or recently interacting). */
export function canRefreshNow(doc: Document, lastInteractionAt: number, now = Date.now()): { ok: boolean; reason?: string } {
  const active = doc.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/u.test(active.tagName))) {
    return { ok: false, reason: 'user is typing' };
  }
  if (now - lastInteractionAt < 30_000) return { ok: false, reason: 'user interacted recently' };
  return { ok: true };
}
