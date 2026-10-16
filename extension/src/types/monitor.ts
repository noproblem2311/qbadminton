import type { RawFacebookPost } from './post';

export interface Settings {
  backendUrl: string;
  apiKey: string;
  /** Default for newly started monitors. */
  refreshIntervalMinutes: number;
}

/**
 * active  – bound to a tab that is on the group page
 * paused  – bound to a tab that navigated away from the group
 * dormant – tab gone after a browser restart; rebinds when the group is opened again
 */
export type MonitorStatus = 'active' | 'paused' | 'dormant';

export interface MonitorState {
  id: string;
  tabId: number | null;
  groupId: string;
  groupUrl: string;
  status: MonitorStatus;
  intervalMinutes: number;
  startedAt: string;
  lastScanAt: string | null;
  lastRefreshAt: string | null;
  /** Set while a reload is in flight; prevents overlapping refreshes. */
  refreshingSince: string | null;
  extractedCount: number;
  submittedCount: number;
  lastError: string | null;
}

export interface BackendStatus {
  ok: boolean;
  checkedAt: string;
  message: string | null;
}

export interface OutboxItem {
  key: string;
  monitorId: string | null;
  post: RawFacebookPost;
  attempts: number;
  enqueuedAt: string;
}

export interface OutboxRetryState {
  failures: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}
