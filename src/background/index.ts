import type {
  FreezeResponse,
  ListResponse,
  Message,
  RestoreResponse,
} from "../messages";
import {
  getFreeze,
  getPending,
  listFreezes,
  removeFreeze,
  renameFreeze,
  saveFreeze,
  setPending,
} from "../storage";
import type { Freeze, FrozenTab } from "../types";

/** Only ordinary web pages can host a content script. */
const CAPTURABLE = /^https?:\/\//i;
const NO_GROUP = -1;

function defaultName(tabCount: number): string {
  const when = new Date().toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return when + " · " + tabCount + (tabCount === 1 ? " tab" : " tabs");
}

async function captureTab(
  tab: chrome.tabs.Tab,
  groupCache: Map<number, chrome.tabGroups.TabGroup>,
): Promise<FrozenTab> {
  const base: FrozenTab = {
    url: tab.url ?? "",
    title: tab.title ?? tab.url ?? "Untitled",
    favIconUrl: tab.favIconUrl,
    pinned: Boolean(tab.pinned),
    index: tab.index,
    active: Boolean(tab.active),
    context: null,
  };

  const groupId = tab.groupId ?? NO_GROUP;
  if (groupId !== NO_GROUP) {
    let group = groupCache.get(groupId);
    if (!group) {
      try {
        group = await chrome.tabGroups.get(groupId);
        groupCache.set(groupId, group);
      } catch {
        group = undefined;
      }
    }
    if (group) {
      base.groupTitle = group.title || "Group";
      base.groupColor = group.color;
    }
  }

  if (!base.url || !CAPTURABLE.test(base.url) || tab.id == null) {
    base.captureError = "Chrome does not allow extensions to read this page.";
    return base;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CF_CAPTURE" });
    if (response?.ok) base.context = response.context;
    else base.captureError = response?.error ?? "No response from the page.";
  } catch {
    // Almost always "tab was open before the extension was installed, or is
    // discarded, so there is no content script in it yet".
    base.captureError = "Page not instrumented - reload it and freeze again.";
  }

  return base;
}

async function freezeWindow(windowId: number): Promise<FreezeResponse> {
  const tabs = await chrome.tabs.query({ windowId });
  if (!tabs.length) return { ok: false, error: "No tabs in this window." };

  const groupCache = new Map<number, chrome.tabGroups.TabGroup>();
  const frozen: FrozenTab[] = [];
  for (const tab of tabs) {
    frozen.push(await captureTab(tab, groupCache));
  }

  const freeze: Freeze = {
    id: crypto.randomUUID(),
    name: defaultName(frozen.length),
    createdAt: Date.now(),
    tabs: frozen,
  };
  await saveFreeze(freeze);

  const skipped = frozen.filter((t) => t.context === null).length;
  return { ok: true, freeze, skipped };
}

async function restoreFreeze(id: string): Promise<RestoreResponse> {
  const freeze = await getFreeze(id);
  if (!freeze) return { ok: false, error: "That freeze no longer exists." };

  const openable = freeze.tabs.filter((t) => CAPTURABLE.test(t.url));
  const skipped = freeze.tabs.length - openable.length;
  if (!openable.length) return { ok: false, error: "Nothing in this freeze can be reopened." };

  const win = await chrome.windows.create({
    url: openable.map((t) => t.url),
    focused: true,
  });
  const created = win.tabs ?? [];

  // Hand each new tab its context. The content script asks for this as soon as
  // it loads; whichever of the two arrives second is the one that matters.
  const pending = await getPending();
  const queuedAt = Date.now();
  created.forEach((tab, index) => {
    const source = openable[index];
    if (tab.id != null && source?.context) {
      pending[String(tab.id)] = { url: source.url, context: source.context, queuedAt };
    }
  });
  await setPending(pending);

  // Pinned tabs cannot belong to a group, so pinning wins and grouping skips them.
  const grouping = new Map<string, { ids: number[]; color?: string }>();
  for (let i = 0; i < created.length; i++) {
    const tab = created[i];
    const source = openable[i];
    if (!tab || tab.id == null || !source) continue;

    if (source.pinned) {
      try { await chrome.tabs.update(tab.id, { pinned: true }); } catch { /* ignore */ }
      continue;
    }
    if (!source.groupTitle) continue;

    const entry = grouping.get(source.groupTitle) ?? { ids: [], color: source.groupColor };
    entry.ids.push(tab.id);
    grouping.set(source.groupTitle, entry);
  }

  for (const [title, entry] of grouping) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: entry.ids,
        createProperties: { windowId: win.id },
      });
      await chrome.tabGroups.update(groupId, {
        title,
        color: entry.color as chrome.tabGroups.ColorEnum | undefined,
      });
    } catch {
      /* grouping is a nicety, never a reason to fail the restore */
    }
  }

  return { ok: true, opened: openable.length, skipped };
}

async function flashBadge(text: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1d63d1" });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 1800);
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case "CF_CONTENT_READY": {
        const tabId = sender.tab?.id;
        if (tabId == null) return sendResponse({});
        const pending = await getPending();
        const key = String(tabId);
        const entry = pending[key];
        if (!entry) return sendResponse({});
        delete pending[key];
        await setPending(pending);
        return sendResponse({ context: entry.context });
      }
      case "CF_FREEZE_WINDOW":
        return sendResponse(await freezeWindow(message.windowId));
      case "CF_LIST_FREEZES":
        return sendResponse({ freezes: await listFreezes() } satisfies ListResponse);
      case "CF_RESTORE_FREEZE":
        return sendResponse(await restoreFreeze(message.id));
      case "CF_DELETE_FREEZE":
        await removeFreeze(message.id);
        return sendResponse({ ok: true });
      case "CF_RENAME_FREEZE":
        await renameFreeze(message.id, message.name);
        return sendResponse({ ok: true });
      default:
        return sendResponse({});
    }
  })();
  return true; // keep the message channel open for the async work above
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "freeze-window") return;
  void (async () => {
    const win = await chrome.windows.getLastFocused();
    if (win.id == null) return;
    const result = await freezeWindow(win.id);
    await flashBadge(result.ok ? String(result.freeze.tabs.length) : "!");
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const pending = await getPending();
    if (pending[String(tabId)]) {
      delete pending[String(tabId)];
      await setPending(pending);
    }
  })();
});

// Content scripts declared in the manifest only run on navigation, so tabs that
// were already open when the extension was installed have none. Inject once.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {
        /* restricted page, fine */
      }
    }
  })();
});
