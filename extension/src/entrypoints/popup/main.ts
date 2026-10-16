import { browser } from 'wxt/browser';
import { sendMessage } from '../../services/messaging';
import type { PopupState } from '../../types/messages';
import type { BackendStatus, MonitorStatus } from '../../types/monitor';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  badge: $('backend-badge'),
  status: $('status'),
  groupUrl: $<HTMLAnchorElement>('group-url'),
  tabHint: $('tab-hint'),
  start: $<HTMLButtonElement>('start-btn'),
  stop: $<HTMLButtonElement>('stop-btn'),
  interval: $<HTMLInputElement>('interval'),
  lastScan: $('last-scan'),
  lastRefresh: $('last-refresh'),
  extracted: $('extracted'),
  submitted: $('submitted'),
  queue: $('queue'),
  nextRetry: $('next-retry'),
  lastError: $('last-error'),
  sort: $<HTMLButtonElement>('sort-btn'),
  backendUrl: $<HTMLInputElement>('backend-url'),
  apiKey: $<HTMLInputElement>('api-key'),
  save: $<HTMLButtonElement>('save-btn'),
  check: $<HTMLButtonElement>('check-btn'),
  settingsMsg: $('settings-msg'),
  footer: $('footer'),
};

const STATUS_LABEL: Record<MonitorStatus, string> = {
  active: '● Đang theo dõi',
  paused: '⏸ Tạm dừng — tab đã rời nhóm',
  dormant: '○ Chờ mở lại nhóm',
};

let state: PopupState | null = null;
let settingsLoaded = false;

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString('vi-VN') : date.toLocaleString('vi-VN');
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderBackend(status: BackendStatus | null) {
  els.badge.className = `badge ${status ? (status.ok ? 'ok' : 'bad') : ''}`;
  els.badge.textContent = status ? (status.ok ? 'Máy chủ OK' : 'Mất kết nối') : 'Chưa kiểm tra';
  els.badge.title = status?.message ?? `Kiểm tra lúc ${formatTime(status?.checkedAt ?? null)}`;
}

function render(next: PopupState) {
  state = next;
  const { tab, monitor } = next;

  els.status.className = `status ${monitor?.status ?? ''}`;
  els.status.textContent = monitor ? STATUS_LABEL[monitor.status] : '○ Chưa theo dõi';

  const groupLink = monitor?.groupUrl ?? (tab.groupId ? `https://www.facebook.com/groups/${tab.groupId}/` : null);
  els.groupUrl.textContent = groupLink ?? '—';
  if (groupLink) els.groupUrl.href = groupLink;
  else els.groupUrl.removeAttribute('href');

  els.tabHint.hidden = Boolean(tab.groupId);
  els.tabHint.textContent = 'Mở một nhóm Facebook (facebook.com/groups/…) trong tab này để bắt đầu.';

  els.start.disabled = !tab.groupId || tab.id === null || monitor?.status === 'active';
  els.stop.disabled = !monitor;

  if (document.activeElement !== els.interval) {
    els.interval.value = String(monitor?.intervalMinutes ?? next.settings.refreshIntervalMinutes);
  }

  els.lastScan.textContent = formatTime(monitor?.lastScanAt ?? null);
  els.lastRefresh.textContent = formatTime(monitor?.lastRefreshAt ?? null);
  els.extracted.textContent = String(monitor?.extractedCount ?? 0);
  els.submitted.textContent = String(monitor?.submittedCount ?? 0);
  els.queue.textContent = String(next.queueSize);
  els.nextRetry.textContent = formatTime(next.nextRetryAt);

  els.lastError.hidden = !monitor?.lastError;
  els.lastError.textContent = monitor?.lastError ? `Lỗi gần nhất: ${monitor.lastError}` : '';

  const url = tab.url ? new URL(tab.url) : null;
  els.sort.hidden = !tab.groupId || url?.searchParams.get('sorting_setting') === 'CHRONOLOGICAL';

  if (!settingsLoaded) {
    settingsLoaded = true;
    els.backendUrl.value = next.settings.backendUrl;
    els.apiKey.placeholder = next.settings.hasApiKey ? 'Đã lưu — để trống để giữ nguyên' : 'Dán API key của máy chủ';
    if (!next.settings.hasApiKey) (document.getElementById('settings') as HTMLDetailsElement).open = true;
  }

  renderBackend(next.backend);
  els.footer.textContent = `Đang theo dõi ${next.monitorCount} tab nhóm`;
}

async function refresh() {
  try {
    const tab = await activeTab();
    render(await sendMessage<PopupState>({ type: 'popup:get-state', tabId: tab?.id ?? null, url: tab?.url ?? null }));
  } catch (error) {
    els.footer.textContent = error instanceof Error ? error.message : String(error);
  }
}

function showError(error: unknown) {
  els.lastError.hidden = false;
  els.lastError.textContent = error instanceof Error ? error.message : String(error);
}

els.start.addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab?.id === undefined || !tab.url) return;
  try {
    await sendMessage({ type: 'popup:start', tabId: tab.id, url: tab.url, intervalMinutes: Number(els.interval.value) });
  } catch (error) {
    showError(error);
  }
  await refresh();
});

els.stop.addEventListener('click', async () => {
  if (state?.tab.id == null) return;
  await sendMessage({ type: 'popup:stop', tabId: state.tab.id }).catch(showError);
  await refresh();
});

els.interval.addEventListener('change', async () => {
  if (state?.tab.id == null || !state.monitor) return;
  await sendMessage({ type: 'popup:set-interval', tabId: state.tab.id, intervalMinutes: Number(els.interval.value) }).catch(showError);
  await refresh();
});

els.sort.addEventListener('click', async () => {
  if (state?.tab.id == null || !state.tab.url) return;
  const url = new URL(state.tab.url);
  url.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
  await browser.tabs.update(state.tab.id, { url: url.toString() });
  window.close();
});

els.save.addEventListener('click', async () => {
  let origin: string;
  try {
    origin = new URL(els.backendUrl.value.trim()).origin;
  } catch {
    els.settingsMsg.textContent = 'Backend URL không hợp lệ.';
    return;
  }
  // Must be requested synchronously within the click (user gesture).
  const granted = await browser.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted) {
    els.settingsMsg.textContent = 'Cần cấp quyền truy cập máy chủ này để gửi dữ liệu.';
    return;
  }
  try {
    const status = await sendMessage<BackendStatus>({
      type: 'popup:save-settings',
      settings: { backendUrl: els.backendUrl.value, apiKey: els.apiKey.value },
    });
    els.apiKey.value = '';
    els.apiKey.placeholder = 'Đã lưu — để trống để giữ nguyên';
    els.settingsMsg.textContent = status.ok ? 'Đã lưu. Kết nối máy chủ thành công.' : `Đã lưu, nhưng chưa kết nối được: ${status.message ?? ''}`;
    renderBackend(status);
  } catch (error) {
    els.settingsMsg.textContent = error instanceof Error ? error.message : String(error);
  }
});

els.check.addEventListener('click', async () => {
  els.settingsMsg.textContent = 'Đang kiểm tra…';
  const status = await sendMessage<BackendStatus>({ type: 'popup:check-backend' }).catch((error: unknown) => ({
    ok: false,
    checkedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
  }));
  els.settingsMsg.textContent = status.ok ? 'Kết nối máy chủ thành công.' : `Không kết nối được: ${status.message ?? ''}`;
  renderBackend(status);
});

void refresh();
void sendMessage<BackendStatus>({ type: 'popup:check-backend' }).then(renderBackend, () => undefined);
setInterval(() => void refresh(), 2_000);
