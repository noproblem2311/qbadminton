import type { MonitorScheduler } from '../monitor/scheduler';
import type { PopupState, RuntimeMessage } from '../types/messages';
import { parseGroupId } from '../utils/facebook-url';
import type { ApiClient } from './api.client';
import type { Outbox } from './outbox.service';
import { clampInterval, type StorageService } from './storage.service';

export interface RouterDeps {
  storage: StorageService;
  scheduler: MonitorScheduler;
  outbox: Outbox;
  api: Pick<ApiClient, 'health'>;
}

interface Sender {
  tab?: { id?: number };
}

function requireTab(sender: Sender): number {
  const tabId = sender.tab?.id;
  if (tabId === undefined) throw new Error('Message must come from a tab');
  return tabId;
}

function normalizeBackendUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Backend URL phải bắt đầu bằng http:// hoặc https://');
  return url.origin + url.pathname.replace(/\/+$/u, '');
}

/** Background message handling for the content script and the popup. */
export function createMessageHandler(deps: RouterDeps) {
  const { storage, scheduler, outbox, api } = deps;

  return async function handle(message: RuntimeMessage, sender: Sender): Promise<unknown> {
    switch (message.type) {
      case 'content:hello':
        return scheduler.handleHello(requireTab(sender), message.url);

      case 'content:posts': {
        const monitor = await scheduler.findByTab(requireTab(sender));
        // Only monitored, active tabs may submit; anything else is ignored.
        if (!monitor || monitor.status !== 'active') return { queued: 0 };
        const queued = await outbox.enqueue(message.posts, monitor.id);
        await scheduler.addExtracted(monitor.id, queued);
        void outbox.flush();
        return { queued };
      }

      case 'content:scan':
        await scheduler.recordScan(requireTab(sender), message.summary.at);
        return null;

      case 'popup:get-state': {
        const [monitors, settings, backend, queue, retry] = await Promise.all([
          storage.get('monitors'),
          storage.get('settings'),
          storage.get('backendStatus'),
          storage.get('outbox'),
          storage.get('outboxRetry'),
        ]);
        const state: PopupState = {
          tab: { id: message.tabId, url: message.url, groupId: parseGroupId(message.url) },
          monitor: monitors.find((monitor) => monitor.tabId !== null && monitor.tabId === message.tabId) ?? null,
          monitorCount: monitors.length,
          settings: {
            backendUrl: settings.backendUrl,
            refreshIntervalMinutes: settings.refreshIntervalMinutes,
            hasApiKey: Boolean(settings.apiKey),
          },
          backend,
          queueSize: queue.length,
          nextRetryAt: retry.nextAttemptAt,
        };
        return state;
      }

      case 'popup:start': {
        const monitor = await scheduler.start(message.tabId, message.url, message.intervalMinutes);
        await storage.update('settings', (settings) => ({
          ...settings,
          refreshIntervalMinutes: clampInterval(message.intervalMinutes),
        }));
        return monitor;
      }

      case 'popup:stop':
        await scheduler.stop(message.tabId);
        return null;

      case 'popup:set-interval':
        return scheduler.setInterval(message.tabId, message.intervalMinutes);

      case 'popup:save-settings': {
        const backendUrl = normalizeBackendUrl(message.settings.backendUrl);
        const apiKey = message.settings.apiKey.trim();
        await storage.update('settings', (settings) => ({
          ...settings,
          backendUrl,
          // An empty field keeps the stored key.
          apiKey: apiKey || settings.apiKey,
        }));
        // New settings deserve an immediate retry instead of waiting out the backoff.
        await storage.set('outboxRetry', { failures: 0, nextAttemptAt: null, lastError: null });
        const status = await api.health();
        await storage.set('backendStatus', status);
        void outbox.flush();
        return status;
      }

      case 'popup:check-backend': {
        const status = await api.health();
        await storage.set('backendStatus', status);
        return status;
      }

      default:
        throw new Error(`Unknown message: ${(message as { type?: string }).type ?? '?'}`);
    }
  };
}
