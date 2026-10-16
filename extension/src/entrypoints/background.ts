import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { MonitorScheduler } from '../monitor/scheduler';
import { ApiClient } from '../services/api.client';
import { createMessageHandler } from '../services/message.router';
import { Outbox } from '../services/outbox.service';
import { StorageService } from '../services/storage.service';
import type { RuntimeMessage } from '../types/messages';

const OUTBOX_RETRY_ALARM = 'outbox:retry';

export default defineBackground(() => {
  const storage = new StorageService();
  const api = new ApiClient(() => storage.get('settings'));
  const scheduler = new MonitorScheduler({ storage });

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const outbox = new Outbox(storage, api, {
    onSubmitted: async (monitorId, count) => {
      await scheduler.addSubmitted(monitorId, count);
      await storage.set('backendStatus', { ok: true, checkedAt: new Date().toISOString(), message: null });
    },
    onError: (monitorIds, message) => scheduler.recordError(monitorIds, message),
    scheduleRetry: (delayMs) => {
      // A timer for short delays while the worker is alive, and an alarm in case it is suspended.
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void outbox.flush(), delayMs);
      void browser.alarms.create(OUTBOX_RETRY_ALARM, { delayInMinutes: Math.max(0.5, delayMs / 60_000) });
    },
  });

  const handle = createMessageHandler({ storage, scheduler, outbox, api });

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    handle(message, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true; // keep the channel open for the async response
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OUTBOX_RETRY_ALARM) void outbox.flush();
    else void scheduler.handleAlarm(alarm.name);
  });

  browser.tabs.onRemoved.addListener((tabId, info) => void scheduler.handleTabRemoved(tabId, info.isWindowClosing));
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined || change.status === 'complete') void scheduler.handleTabUpdated(tabId, change);
  });

  browser.runtime.onStartup.addListener(() => void scheduler.reconcile());
  browser.runtime.onInstalled.addListener(() => void scheduler.reconcile());

  // Runs on every service-worker start: restore alarms and retry pending submissions.
  void scheduler.reconcile().then(() => outbox.flush());
});
