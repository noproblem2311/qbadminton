// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ALARM_PREFIX, MonitorScheduler } from '../src/monitor/scheduler';
import { StorageService } from '../src/services/storage.service';
import type { TabMessage } from '../src/types/messages';

const GROUP_A = 'https://www.facebook.com/groups/caulongdanang/?sorting_setting=CHRONOLOGICAL';
const GROUP_B = 'https://www.facebook.com/groups/badmintonhanoi/';

/** Tabs/alarms/scripting stub with the behaviour the scheduler relies on. */
function createBrowserStub() {
  const tabs = new Map<number, { id: number; url: string; status: string }>();
  const alarms = new Map<string, { name: string; periodInMinutes?: number }>();
  const sent: Array<{ tabId: number; message: TabMessage }> = [];
  const reloads: number[] = [];
  const control = { canRefresh: { ok: true } as { ok: boolean; reason?: string }, receiver: true };

  const browser = {
    tabs: {
      get: async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return tab;
      },
      query: async () => [...tabs.values()],
      reload: async (id: number) => {
        reloads.push(id);
        const tab = tabs.get(id);
        if (tab) tab.status = 'loading';
      },
      sendMessage: async (tabId: number, message: TabMessage) => {
        if (!control.receiver) throw new Error('Could not establish connection. Receiving end does not exist.');
        sent.push({ tabId, message });
        return message.type === 'monitor:can-refresh' ? control.canRefresh : { ok: true };
      },
    },
    alarms: {
      get: async (name: string) => alarms.get(name),
      create: async (name: string, info: { periodInMinutes?: number }) => {
        alarms.set(name, { name, periodInMinutes: info.periodInMinutes });
      },
      clear: async (name: string) => alarms.delete(name),
    },
    scripting: { executeScript: vi.fn(async () => []) },
  };

  const openTab = (id: number, url: string) => tabs.set(id, { id, url, status: 'complete' });
  return { browser, tabs, alarms, sent, reloads, control, openTab };
}

describe('MonitorScheduler', () => {
  let env: ReturnType<typeof createBrowserStub>;
  let storage: StorageService;
  let clock: number;
  let ids: number;

  const makeScheduler = () =>
    new MonitorScheduler({
      storage,
      browser: env.browser as never,
      now: () => clock,
      createId: () => `m${(ids += 1)}`,
    });

  beforeEach(() => {
    fakeBrowser.reset();
    env = createBrowserStub();
    storage = new StorageService();
    clock = Date.parse('2026-10-15T03:00:00Z');
    ids = 0;
  });

  it('starts monitoring the current group tab, persists state and schedules a 3-minute refresh', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    const monitor = await scheduler.start(7, GROUP_A, 3);

    expect(monitor).toMatchObject({ id: 'm1', tabId: 7, groupId: 'caulongdanang', status: 'active', intervalMinutes: 3 });
    expect(await storage.get('monitors')).toHaveLength(1);
    expect(env.alarms.get(`${ALARM_PREFIX}m1`)?.periodInMinutes).toBe(3);
    expect(env.sent).toContainEqual({ tabId: 7, message: { type: 'monitor:activate' } });
  });

  it('refuses tabs that are not Facebook groups', async () => {
    await expect(makeScheduler().start(1, 'https://www.facebook.com/', 3)).rejects.toThrow(/không phải trang nhóm/u);
  });

  it('injects the content script into tabs opened before the extension', async () => {
    env.openTab(7, GROUP_A);
    env.control.receiver = false;
    await makeScheduler().start(7, GROUP_A, 3);
    expect(env.browser.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['/content-scripts/facebook.js'],
    });
  });

  it('restores monitoring when the monitored tab reloads', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    await scheduler.refresh('m1');

    expect(await scheduler.handleHello(7, GROUP_A)).toEqual({ active: true, monitorId: 'm1' });
    expect((await scheduler.findByTab(7))?.refreshingSince).toBeNull();
    expect(await scheduler.handleHello(99, GROUP_A)).toEqual({ active: false, monitorId: null });
  });

  it('refreshes the existing tab and never overlaps refreshes', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);

    expect(await scheduler.handleAlarm(`${ALARM_PREFIX}m1`)).toBe('refreshed');
    expect(await scheduler.refresh('m1')).toBe('busy');
    expect(env.reloads).toEqual([7]);

    await scheduler.handleTabUpdated(7, { status: 'complete' });
    env.tabs.get(7)!.status = 'complete';
    clock += 3 * 60_000;
    expect(await scheduler.refresh('m1')).toBe('refreshed');
    expect(env.reloads).toEqual([7, 7]);
  });

  it('defers a refresh while the user is busy in the tab', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    env.control.canRefresh = { ok: false, reason: 'user is typing' };

    expect(await scheduler.refresh('m1')).toBe('deferred');
    expect(env.reloads).toEqual([]);
  });

  it('pauses when the tab leaves the group and resumes when it returns', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);

    await scheduler.handleTabUpdated(7, { url: 'https://www.facebook.com/watch/' });
    expect((await scheduler.findByTab(7))?.status).toBe('paused');
    expect(await scheduler.refresh('m1')).toBe('skipped');

    await scheduler.handleTabUpdated(7, { url: GROUP_A });
    expect((await scheduler.findByTab(7))?.status).toBe('active');
  });

  it('stops when the tab is closed, but survives the browser closing', async () => {
    env.openTab(7, GROUP_A);
    env.openTab(8, GROUP_B);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    await scheduler.start(8, GROUP_B, 5);

    await scheduler.handleTabRemoved(7, false);
    expect(await scheduler.findByTab(7)).toBeUndefined();
    expect(env.alarms.has(`${ALARM_PREFIX}m1`)).toBe(false);

    await scheduler.handleTabRemoved(8, true);
    expect((await storage.get('monitors'))[0]).toMatchObject({ id: 'm2', tabId: null, status: 'dormant' });
  });

  it('monitors several group tabs independently', async () => {
    env.openTab(7, GROUP_A);
    env.openTab(8, GROUP_B);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    await scheduler.start(8, GROUP_B, 10);

    await scheduler.stop(7);
    expect(await scheduler.findByTab(7)).toBeUndefined();
    expect(await scheduler.findByTab(8)).toMatchObject({ groupId: 'badmintonhanoi', intervalMinutes: 10 });
    expect(env.alarms.get(`${ALARM_PREFIX}m2`)?.periodInMinutes).toBe(10);
    expect(env.sent).toContainEqual({ tabId: 7, message: { type: 'monitor:deactivate' } });
  });

  it('rebinds monitors to new tab IDs after a browser restart', async () => {
    env.openTab(7, GROUP_A);
    env.openTab(8, GROUP_B);
    await makeScheduler().start(7, GROUP_A, 3);
    await makeScheduler().start(8, GROUP_B, 3);

    // Restart: old tabs and alarms are gone; session restore reopens group A as tab 42.
    env.tabs.clear();
    env.alarms.clear();
    env.openTab(42, GROUP_A);
    const restarted = makeScheduler();
    await restarted.reconcile();

    expect(await restarted.findByTab(42)).toMatchObject({ id: 'm1', status: 'active' });
    expect((await storage.get('monitors')).find((m) => m.id === 'm2')).toMatchObject({ tabId: null, status: 'dormant' });
    expect(env.alarms.has(`${ALARM_PREFIX}m1`)).toBe(true);

    // Opening group B later rebinds its dormant monitor via the content script hello.
    expect(await restarted.handleHello(50, GROUP_B)).toEqual({ active: true, monitorId: 'm2' });
  });

  it('clamps and applies interval changes', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    expect((await scheduler.setInterval(7, 0))?.intervalMinutes).toBe(1);
    expect((await scheduler.setInterval(7, 500))?.intervalMinutes).toBe(60);
    expect(env.alarms.get(`${ALARM_PREFIX}m1`)?.periodInMinutes).toBe(60);
  });

  it('tracks extraction, submission and errors per monitor', async () => {
    env.openTab(7, GROUP_A);
    const scheduler = makeScheduler();
    await scheduler.start(7, GROUP_A, 3);
    await scheduler.recordScan(7, '2026-10-15T03:01:00.000Z');
    await scheduler.addExtracted('m1', 4);
    await scheduler.recordError(['m1'], 'API key không hợp lệ');
    await scheduler.addSubmitted('m1', 3);

    expect(await scheduler.findByTab(7)).toMatchObject({
      lastScanAt: '2026-10-15T03:01:00.000Z',
      extractedCount: 4,
      submittedCount: 3,
      lastError: null,
    });
  });
});
