import { browser } from 'wxt/browser';
import { clampInterval, type StorageService } from '../services/storage.service';
import type { CanRefreshResponse, HelloResponse, TabMessage } from '../types/messages';
import type { MonitorState } from '../types/monitor';
import { groupUrl, parseGroupId } from '../utils/facebook-url';

type Browser = typeof browser;

export interface SchedulerDeps {
  storage: StorageService;
  browser?: Pick<Browser, 'tabs' | 'alarms' | 'scripting'>;
  now?: () => number;
  createId?: () => string;
}

export const ALARM_PREFIX = 'refresh:';
/** A reload that has not reported back within this window is considered finished. */
const REFRESH_LOCK_MS = 90_000;
const CONTENT_SCRIPT_FILE = '/content-scripts/facebook.js';
const GROUP_TAB_PATTERNS = ['https://www.facebook.com/groups/*', 'https://web.facebook.com/groups/*'];

export type RefreshOutcome = 'refreshed' | 'skipped' | 'busy' | 'deferred' | 'navigated' | 'tab-missing';

/**
 * Background side of monitoring: one MonitorState per watched tab, persisted in
 * chrome.storage.local, with a chrome.alarms alarm driving each tab's refresh.
 */
export class MonitorScheduler {
  private readonly browser: Pick<Browser, 'tabs' | 'alarms' | 'scripting'>;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly deps: SchedulerDeps) {
    this.browser = deps.browser ?? browser;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => crypto.randomUUID());
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  async list(): Promise<MonitorState[]> {
    return this.deps.storage.get('monitors');
  }

  async findByTab(tabId: number): Promise<MonitorState | undefined> {
    return (await this.list()).find((monitor) => monitor.tabId === tabId);
  }

  async start(tabId: number, url: string, intervalMinutes: number): Promise<MonitorState> {
    const groupId = parseGroupId(url);
    if (!groupId) throw new Error('Tab hiện tại không phải trang nhóm Facebook (facebook.com/groups/...).');
    const interval = clampInterval(intervalMinutes);

    const monitors = await this.deps.storage.update('monitors', (all) => {
      const existing = all.find((monitor) => monitor.tabId === tabId);
      if (existing) {
        Object.assign(existing, { groupId, groupUrl: groupUrl(groupId), status: 'active', intervalMinutes: interval, lastError: null });
        return all;
      }
      return [
        ...all,
        {
          id: this.createId(),
          tabId,
          groupId,
          groupUrl: groupUrl(groupId),
          status: 'active',
          intervalMinutes: interval,
          startedAt: this.iso(),
          lastScanAt: null,
          lastRefreshAt: null,
          refreshingSince: null,
          extractedCount: 0,
          submittedCount: 0,
          lastError: null,
        } satisfies MonitorState,
      ];
    });
    const monitor = monitors.find((item) => item.tabId === tabId)!;
    await this.ensureAlarm(monitor);
    await this.activateContentScript(tabId);
    return monitor;
  }

  async stop(tabId: number): Promise<void> {
    const monitor = await this.findByTab(tabId);
    if (!monitor) return;
    await this.remove(monitor.id);
    await this.sendToTab(tabId, { type: 'monitor:deactivate' }).catch(() => undefined);
  }

  async setInterval(tabId: number, intervalMinutes: number): Promise<MonitorState | undefined> {
    const interval = clampInterval(intervalMinutes);
    const monitor = await this.patchWhere((m) => m.tabId === tabId, { intervalMinutes: interval });
    if (monitor) await this.ensureAlarm(monitor, true);
    return monitor;
  }

  /**
   * Called by the content script on every page load. Rebinds a dormant monitor
   * (after a browser restart) to the first tab that opens its group.
   */
  async handleHello(tabId: number, url: string): Promise<HelloResponse> {
    const groupId = parseGroupId(url);
    let bound: MonitorState | undefined;
    await this.deps.storage.update('monitors', (all) => {
      bound =
        all.find((monitor) => monitor.tabId === tabId) ??
        (groupId ? all.find((monitor) => monitor.status === 'dormant' && monitor.groupId === groupId) : undefined);
      if (!bound) return all;
      const onGroup = groupId === bound.groupId;
      Object.assign(bound, {
        tabId,
        status: onGroup ? 'active' : 'paused',
        refreshingSince: null,
        lastError: onGroup ? bound.lastError : 'Tab đã rời khỏi nhóm đang theo dõi',
      });
      return all;
    });
    if (!bound) return { active: false, monitorId: null };
    await this.ensureAlarm(bound);
    return { active: bound.status === 'active', monitorId: bound.id };
  }

  async handleAlarm(name: string): Promise<RefreshOutcome | null> {
    if (!name.startsWith(ALARM_PREFIX)) return null;
    return this.refresh(name.slice(ALARM_PREFIX.length));
  }

  /** Reload the monitored tab so Facebook loads newer posts; never overlapping, never disruptive. */
  async refresh(monitorId: string): Promise<RefreshOutcome> {
    const monitor = (await this.list()).find((item) => item.id === monitorId);
    if (!monitor) {
      await this.browser.alarms.clear(`${ALARM_PREFIX}${monitorId}`);
      return 'skipped';
    }
    if (monitor.status !== 'active' || monitor.tabId === null) return 'skipped';
    if (monitor.refreshingSince && this.now() - Date.parse(monitor.refreshingSince) < REFRESH_LOCK_MS) return 'busy';

    let tab: { url?: string; status?: string };
    try {
      tab = await this.browser.tabs.get(monitor.tabId);
    } catch {
      await this.patch(monitor.id, { tabId: null, status: 'dormant' });
      return 'tab-missing';
    }
    if (parseGroupId(tab.url) !== monitor.groupId) {
      await this.patch(monitor.id, { status: 'paused', lastError: 'Tab đã rời khỏi nhóm đang theo dõi' });
      return 'navigated';
    }
    if (tab.status === 'loading') return 'busy';

    const verdict = await this.sendToTab<CanRefreshResponse>(monitor.tabId, { type: 'monitor:can-refresh' }).catch(
      () => ({ ok: true }) as CanRefreshResponse,
    );
    if (!verdict.ok) return 'deferred';

    await this.patch(monitor.id, { refreshingSince: this.iso(), lastRefreshAt: this.iso() });
    await this.browser.tabs.reload(monitor.tabId);
    return 'refreshed';
  }

  async handleTabRemoved(tabId: number, isWindowClosing: boolean): Promise<void> {
    const monitor = await this.findByTab(tabId);
    if (!monitor) return;
    // Closing the browser keeps the monitor so it can rebind after restart.
    if (isWindowClosing) await this.patch(monitor.id, { tabId: null, status: 'dormant', refreshingSince: null });
    else await this.remove(monitor.id);
  }

  async handleTabUpdated(tabId: number, change: { url?: string; status?: string }): Promise<void> {
    const monitor = await this.findByTab(tabId);
    if (!monitor) return;
    if (change.url !== undefined) {
      const onGroup = parseGroupId(change.url) === monitor.groupId;
      await this.patch(monitor.id, {
        status: onGroup ? 'active' : 'paused',
        lastError: onGroup ? monitor.lastError : 'Tab đã rời khỏi nhóm đang theo dõi',
      });
    }
    if (change.status === 'complete' && monitor.refreshingSince) {
      await this.patch(monitor.id, { refreshingSince: null });
    }
  }

  /** After browser start / extension update: drop stale tab IDs, rebind by group URL, restore alarms. */
  async reconcile(): Promise<void> {
    const openTabs = await this.browser.tabs.query({ url: GROUP_TAB_PATTERNS }).catch(() => []);
    const monitors = await this.deps.storage.update('monitors', async (all) => {
      const claimed = new Set<number>();
      for (const monitor of all) {
        if (monitor.tabId === null) continue;
        const tab = openTabs.find((candidate) => candidate.id === monitor.tabId);
        if (tab && parseGroupId(tab.url) === monitor.groupId) claimed.add(monitor.tabId);
        else if (!tab) Object.assign(monitor, { tabId: null, status: 'dormant', refreshingSince: null });
      }
      for (const monitor of all.filter((item) => item.status === 'dormant')) {
        const tab = openTabs.find(
          (candidate) => candidate.id !== undefined && !claimed.has(candidate.id) && parseGroupId(candidate.url) === monitor.groupId,
        );
        if (tab?.id !== undefined) {
          claimed.add(tab.id);
          Object.assign(monitor, { tabId: tab.id, status: 'active' });
        }
      }
      return all;
    });
    await Promise.all(monitors.map((monitor) => this.ensureAlarm(monitor)));
  }

  async recordScan(tabId: number, at: string): Promise<void> {
    await this.patchWhere((monitor) => monitor.tabId === tabId, { lastScanAt: at });
  }

  async addExtracted(monitorId: string, count: number): Promise<void> {
    if (count <= 0) return;
    await this.deps.storage.update('monitors', (all) => {
      const monitor = all.find((item) => item.id === monitorId);
      if (monitor) monitor.extractedCount += count;
      return all;
    });
  }

  async addSubmitted(monitorId: string, count: number): Promise<void> {
    await this.deps.storage.update('monitors', (all) => {
      const monitor = all.find((item) => item.id === monitorId);
      if (monitor) Object.assign(monitor, { submittedCount: monitor.submittedCount + count, lastError: null });
      return all;
    });
  }

  async recordError(monitorIds: Array<string | null>, message: string): Promise<void> {
    const ids = new Set(monitorIds);
    await this.deps.storage.update('monitors', (all) => {
      for (const monitor of all) if (ids.has(monitor.id)) monitor.lastError = message;
      return all;
    });
  }

  private async ensureAlarm(monitor: MonitorState, replace = false): Promise<void> {
    const name = `${ALARM_PREFIX}${monitor.id}`;
    const existing = await this.browser.alarms.get(name);
    if (existing && !replace && existing.periodInMinutes === monitor.intervalMinutes) return;
    await this.browser.alarms.create(name, {
      delayInMinutes: monitor.intervalMinutes,
      periodInMinutes: monitor.intervalMinutes,
    });
  }

  private async remove(monitorId: string): Promise<void> {
    await this.deps.storage.update('monitors', (all) => all.filter((monitor) => monitor.id !== monitorId));
    await this.browser.alarms.clear(`${ALARM_PREFIX}${monitorId}`);
  }

  private patch(monitorId: string, values: Partial<MonitorState>): Promise<MonitorState | undefined> {
    return this.patchWhere((monitor) => monitor.id === monitorId, values);
  }

  private async patchWhere(
    predicate: (monitor: MonitorState) => boolean,
    values: Partial<MonitorState>,
  ): Promise<MonitorState | undefined> {
    let patched: MonitorState | undefined;
    await this.deps.storage.update('monitors', (all) => {
      patched = all.find(predicate);
      if (patched) Object.assign(patched, values);
      return all;
    });
    return patched;
  }

  private sendToTab<T = unknown>(tabId: number, message: TabMessage): Promise<T> {
    return this.browser.tabs.sendMessage(tabId, message) as Promise<T>;
  }

  /** Activate the content script; inject it first into tabs opened before installation. */
  private async activateContentScript(tabId: number): Promise<void> {
    try {
      await this.sendToTab(tabId, { type: 'monitor:activate' });
    } catch {
      // No receiver yet: the injected script says hello and activates itself.
      await this.browser.scripting
        .executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] })
        .catch(() => undefined);
    }
  }
}
