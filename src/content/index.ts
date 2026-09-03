import type { CaptureResponse, ContentReadyResponse, Message } from "../messages";
import { capturePage, installSelectionTracker } from "./capture";
import { restorePage } from "./restore";

declare global {
  interface Window {
    __contextFreezeLoaded?: boolean;
  }
}

/**
 * The manifest injects this at document_idle, and the service worker injects it
 * again into pre-existing tabs on install. Both can hit the same page.
 */
if (!window.__contextFreezeLoaded && window.top === window) {
  window.__contextFreezeLoaded = true;

  // Must run immediately, not at capture time: opening the extension popup
  // takes focus off the page, which collapses a selection inside an editor
  // before capture ever gets to look at it.
  installSelectionTracker();

  let restoring = false;

  async function runRestore(context: Parameters<typeof restorePage>[0]): Promise<void> {
    if (restoring) return;
    restoring = true;
    try {
      const report = await restorePage(context);
      void chrome.runtime.sendMessage({ type: "CF_RESTORE_REPORT", report }).catch(() => {});
    } finally {
      restoring = false;
    }
  }

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message.type === "CF_CAPTURE") {
      try {
        const context = capturePage();
        console.debug("[ContextFreeze] captured", {
          scrolls: context.scrolls.length,
          fields: context.fields.length,
          media: context.media.length,
          highlight: context.selection ? context.selection.text.slice(0, 40) : null,
          editable: context.selection?.editable ?? null,
        });
        sendResponse({ ok: true, context } satisfies CaptureResponse);
      } catch (error) {
        sendResponse({ ok: false, error: String(error) } satisfies CaptureResponse);
      }
      return true;
    }

    if (message.type === "CF_RESTORE") {
      void runRestore(message.context);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  /**
   * Ask the service worker whether this tab was opened by a restore.
   *
   * Retried, because the worker writes the pending map immediately after
   * chrome.windows.create resolves and a cached page can finish loading first.
   */
  async function handshake(): Promise<void> {
    const delays = [0, 300, 900];
    for (const delay of delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (restoring) return;
      try {
        const response: ContentReadyResponse = await chrome.runtime.sendMessage({
          type: "CF_CONTENT_READY",
          url: location.href,
        });
        if (response?.context) {
          await runRestore(response.context);
          return;
        }
      } catch {
        // Service worker asleep or extension reloading; the next attempt covers it.
      }
    }
  }

  void handshake();
}
