import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GroupMonitor, canRefreshNow } from '../monitor/group.monitor';
import { sendMessage } from '../services/messaging';
import type { HelloResponse, TabMessage } from '../types/messages';
import { parseGroupId } from '../utils/facebook-url';

/**
 * Runs in Facebook tabs the user already has open and is logged into. It only reads
 * the rendered feed; it never touches cookies, tokens or credentials, and stays idle
 * unless the background says this tab is being monitored.
 */
export default defineContentScript({
  matches: ['https://www.facebook.com/*', 'https://web.facebook.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let monitor: GroupMonitor | null = null;
    let lastInteractionAt = 0;

    const markInteraction = () => {
      lastInteractionAt = Date.now();
    };
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) {
      ctx.addEventListener(window, type, markInteraction, { passive: true, capture: true });
    }

    const activate = () => {
      if (monitor?.isActive()) {
        void monitor.scan();
        return;
      }
      monitor = new GroupMonitor({
        doc: document,
        getGroupId: () => parseGroupId(location.href),
        submit: async (posts) => {
          await sendMessage({ type: 'content:posts', posts });
        },
        onScan: (summary) => void sendMessage({ type: 'content:scan', summary }).catch(() => undefined),
      });
      void monitor.start();
    };

    const deactivate = () => {
      monitor?.stop();
      monitor = null;
    };

    const sync = async () => {
      try {
        const hello = await sendMessage<HelloResponse>({ type: 'content:hello', url: location.href });
        if (hello.active) activate();
        else deactivate();
      } catch {
        deactivate(); // background unavailable (e.g. extension reloaded)
      }
    };

    browser.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      switch (message.type) {
        case 'monitor:activate':
          activate();
          sendResponse({ ok: true });
          break;
        case 'monitor:deactivate':
          deactivate();
          sendResponse({ ok: true });
          break;
        case 'monitor:can-refresh':
          sendResponse(canRefreshNow(document, lastInteractionAt));
          break;
      }
      return false;
    });

    // Facebook is a SPA: re-check monitoring when the URL changes without a reload.
    ctx.addEventListener(window, 'wxt:locationchange', () => void sync());
    ctx.onInvalidated(deactivate);
    void sync();
  },
});
