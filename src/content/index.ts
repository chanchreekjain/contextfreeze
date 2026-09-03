import type { CaptureResponse, ContentReadyResponse, Message } from "../messages";
import { capturePage, installSelectionTracker } from "./capture";
import { dropCheckpoint, jumpTo } from "./checkpoint";
import { askForName } from "./namer";
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

    if (message.type === "CF_DROP") {
      const draft = dropCheckpoint(message.kind);
      sendResponse(
        draft
          ? { ok: true, draft }
          : { ok: false, error: "Nothing to mark here - no video or audio on this page." },
      );
      return true;
    }

    if (message.type === "CF_NAME_PROMPT") {
      const { id, defaultLabel, kind } = message;
      void askForName(defaultLabel, kind).then((label) => {
        if (label) {
          void chrome.runtime.sendMessage({ type: "CF_RENAME_CHECKPOINT", id, label }).catch(() => {});
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CF_JUMP") {
      void jumpTo(message.checkpoint);
      sendResponse({ ok: true });
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

  /**
   * Keep the "Last position" entry current for pages the user has chosen to
   * follow. The background decides whether this page qualifies - the content
   * script does not get to quietly record every page you visit.
   *
   * Fired when the tab is hidden or unloaded, which is when you have in fact
   * left off, and throttled so tab-flicking does not spam storage.
   */
  let lastAutosave = 0;
  const AUTOSAVE_MIN_INTERVAL_MS = 5_000;

  function autosave(): void {
    if (Date.now() - lastAutosave < AUTOSAVE_MIN_INTERVAL_MS) return;
    lastAutosave = Date.now();
    const draft = dropCheckpoint("position", true);
    if (draft) void chrome.runtime.sendMessage({ type: "CF_AUTOSAVE", draft }).catch(() => {});
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosave();
  });
  window.addEventListener("pagehide", autosave);
}
