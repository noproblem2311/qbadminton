import { browser } from 'wxt/browser';
import type {
  BackendStatus,
  MonitorState,
  OutboxItem,
  OutboxRetryState,
  Settings,
} from '../types/monitor';

export const DEFAULT_REFRESH_MINUTES = 3;
export const MIN_REFRESH_MINUTES = 1;
export const MAX_REFRESH_MINUTES = 60;

export const DEFAULT_BACKEND_URL: string =
  (import.meta.env.WXT_BACKEND_URL as string | undefined) || 'http://localhost:8082';

export interface StorageSchema {
  settings: Settings;
  monitors: MonitorState[];
  outbox: OutboxItem[];
  outboxRetry: OutboxRetryState;
  /** Keys the backend has acknowledged; bounded, oldest dropped first. */
  sentKeys: string[];
  backendStatus: BackendStatus | null;
}

const DEFAULTS: StorageSchema = {
  settings: { backendUrl: DEFAULT_BACKEND_URL, apiKey: '', refreshIntervalMinutes: DEFAULT_REFRESH_MINUTES },
  monitors: [],
  outbox: [],
  outboxRetry: { failures: 0, nextAttemptAt: null, lastError: null },
  sentKeys: [],
  backendStatus: null,
};

type StorageArea = Pick<typeof browser.storage.local, 'get' | 'set'>;

/**
 * Typed wrapper over chrome.storage.local. `update` serializes read-modify-write
 * cycles so concurrent message handlers cannot lose each other's changes.
 */
export class StorageService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageArea = browser.storage.local) {}

  async get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
    const stored = (await this.area.get(key))[key] as StorageSchema[K] | undefined;
    if (stored === undefined || stored === null) return structuredClone(DEFAULTS[key]);
    if (key === 'settings') return { ...DEFAULTS.settings, ...(stored as Settings) } as StorageSchema[K];
    return stored;
  }

  async set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
    await this.area.set({ [key]: value });
  }

  update<K extends keyof StorageSchema>(
    key: K,
    mutate: (current: StorageSchema[K]) => StorageSchema[K] | Promise<StorageSchema[K]>,
  ): Promise<StorageSchema[K]> {
    const run = this.queue.then(async () => {
      const next = await mutate(await this.get(key));
      await this.set(key, next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(minutes)));
}
