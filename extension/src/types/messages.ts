import type { BackendStatus, MonitorState, Settings } from './monitor';
import type { RawFacebookPost } from './post';

export interface ExtractedPost {
  /** Dedup key: Facebook post ID when known, otherwise the content fingerprint. */
  key: string;
  post: RawFacebookPost;
}

export interface ScanSummary {
  candidates: number;
  extracted: number;
  at: string;
}

/** Content script → background. */
export type ContentMessage =
  | { type: 'content:hello'; url: string }
  | { type: 'content:posts'; posts: ExtractedPost[] }
  | { type: 'content:scan'; summary: ScanSummary };

/** Popup → background. */
export type PopupMessage =
  | { type: 'popup:get-state'; tabId: number | null; url: string | null }
  | { type: 'popup:start'; tabId: number; url: string; intervalMinutes: number }
  | { type: 'popup:stop'; tabId: number }
  | { type: 'popup:set-interval'; tabId: number; intervalMinutes: number }
  | { type: 'popup:save-settings'; settings: Pick<Settings, 'backendUrl' | 'apiKey'> }
  | { type: 'popup:check-backend' };

/** Background → content script. */
export type TabMessage =
  | { type: 'monitor:activate' }
  | { type: 'monitor:deactivate' }
  | { type: 'monitor:can-refresh' };

export type RuntimeMessage = ContentMessage | PopupMessage;

export interface HelloResponse {
  active: boolean;
  monitorId: string | null;
}

export interface CanRefreshResponse {
  ok: boolean;
  reason?: string;
}

export interface PopupState {
  tab: { id: number | null; url: string | null; groupId: string | null };
  monitor: MonitorState | null;
  monitorCount: number;
  settings: Pick<Settings, 'backendUrl' | 'refreshIntervalMinutes'> & { hasApiKey: boolean };
  backend: BackendStatus | null;
  queueSize: number;
  nextRetryAt: string | null;
}

/** Envelope for every runtime response so errors survive the message boundary. */
export type MessageResult<T> = { ok: true; data: T } | { ok: false; error: string };
