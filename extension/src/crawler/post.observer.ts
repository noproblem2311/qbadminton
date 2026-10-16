export interface FeedObserverOptions {
  debounceMs: number;
  /** Upper bound on how long a continuous stream of mutations can postpone a scan. */
  maxWaitMs: number;
}

const DEFAULT_OPTIONS: FeedObserverOptions = { debounceMs: 800, maxWaitMs: 4_000 };

/**
 * Debounced MutationObserver. It watches the whole body because Facebook replaces
 * the feed element on navigation. It only reacts to added elements: it detects
 * posts Facebook has rendered, but cannot load posts Facebook has not fetched.
 */
export class FeedObserver {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingSince: number | null = null;

  constructor(
    private readonly root: Node,
    private readonly onChange: () => void,
    private readonly options: FeedObserverOptions = DEFAULT_OPTIONS,
  ) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      const addedElement = records.some((record) =>
        Array.from(record.addedNodes).some((node) => node.nodeType === 1),
      );
      if (addedElement) this.schedule();
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingSince = null;
  }

  private schedule(): void {
    const now = Date.now();
    this.pendingSince ??= now;
    if (this.timer) clearTimeout(this.timer);
    const remaining = this.options.maxWaitMs - (now - this.pendingSince);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.pendingSince = null;
        this.onChange();
      },
      Math.max(0, Math.min(this.options.debounceMs, remaining)),
    );
  }
}
