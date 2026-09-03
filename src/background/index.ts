import type {
  CheckpointDraft,
  DropResponse,
  FreezeResponse,
  ListResponse,
  Message,
  RestoreResponse,
  SimpleResponse,
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
import {
  allCheckpoints,
  checkpointsForPage,
  pageIsTracked,
  pageKey,
  removeCheckpoint,
  renameCheckpoint,
  saveCheckpoint,
} from "../checkpoints";
import { resumeUrl } from "../site-adapters";
import type { Checkpoint, CheckpointKind, Freeze, FrozenTab, RestoreReport } from "../types";

const JUMPS_KEY = "cf_pending_jumps";
const REPORTS_KEY = "cf_reports";
const MAX_REPORTS = 20;

async function recordReport(report: RestoreReport): Promise<void> {
  const data = await chrome.storage.session.get(REPORTS_KEY);
  const previous = (data[REPORTS_KEY] as RestoreReport[] | undefined) ?? [];
  await chrome.storage.session.set({
    [REPORTS_KEY]: [report, ...previous].slice(0, MAX_REPORTS),
  });
}

type PendingJumps = Record<string, Checkpoint>;

async function getJumps(): Promise<PendingJumps> {
  const data = await chrome.storage.session.get(JUMPS_KEY);
  return (data[JUMPS_KEY] as PendingJumps | undefined) ?? {};
}

async function setJumps(map: PendingJumps): Promise<void> {
  await chrome.storage.session.set({ [JUMPS_KEY]: map });
}

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
    // resumeUrl hands sites with their own resume mechanism (YouTube's ?t=)
    // the timestamp up front, rather than seeking after their player boots.
    url: openable.map(resumeUrl),
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

async function addCheckpoint(tabId: number, kind: CheckpointKind): Promise<SimpleResponse> {
  let draft: CheckpointDraft;
  try {
    const response: DropResponse = await chrome.tabs.sendMessage(tabId, { type: "CF_DROP", kind });
    if (!response.ok) return response;
    draft = response.draft;
  } catch {
    return { ok: false, error: "Reload this page, then try again." };
  }

  await saveCheckpoint({ ...draft, id: crypto.randomUUID(), key: pageKey(draft.url) });
  return { ok: true };
}

/**
 * Jumping within the page you are already on should not reload it - that would
 * throw away everything else on screen. Only navigate when the tab has actually
 * moved somewhere else, and then hand the checkpoint over the same way a
 * restore does, via the content script's handshake.
 */
async function jumpToCheckpoint(tabId: number, id: string): Promise<SimpleResponse> {
  const tab = await chrome.tabs.get(tabId);
  const checkpoint = (await allCheckpoints()).find((c) => c.id === id);
  if (!checkpoint) return { ok: false, error: "That checkpoint no longer exists." };

  if (tab.url && pageKey(tab.url) === checkpoint.key) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "CF_JUMP", checkpoint });
      return { ok: true };
    } catch {
      return { ok: false, error: "Reload this page, then try again." };
    }
  }

  const jumps = await getJumps();
  jumps[String(tabId)] = checkpoint;
  await setJumps(jumps);
  await chrome.tabs.update(tabId, { url: checkpoint.url });
  return { ok: true };
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

        const jumps = await getJumps();
        const jump = jumps[String(tabId)];
        if (jump) {
          delete jumps[String(tabId)];
          await setJumps(jumps);
          void chrome.tabs.sendMessage(tabId, { type: "CF_JUMP", checkpoint: jump }).catch(() => {});
        }

        const pending = await getPending();
        const key = String(tabId);
        const entry = pending[key];
        if (!entry) return sendResponse({});
        delete pending[key];
        await setPending(pending);
        return sendResponse({ context: entry.context });
      }
      case "CF_RESTORE_REPORT":
        await recordReport(message.report);
        return sendResponse({ ok: true });
      case "CF_LAST_REPORTS": {
        const data = await chrome.storage.session.get(REPORTS_KEY);
        return sendResponse({ reports: (data[REPORTS_KEY] as RestoreReport[] | undefined) ?? [] });
      }
      case "CF_ADD_CHECKPOINT":
        return sendResponse(await addCheckpoint(message.tabId, message.kind));
      case "CF_LIST_CHECKPOINTS":
        return sendResponse({ checkpoints: await checkpointsForPage(message.url) });
      case "CF_JUMP_CHECKPOINT":
        return sendResponse(await jumpToCheckpoint(message.tabId, message.id));
      case "CF_DELETE_CHECKPOINT":
        await removeCheckpoint(message.id);
        return sendResponse({ ok: true });
      case "CF_RENAME_CHECKPOINT":
        await renameCheckpoint(message.id, message.label);
        return sendResponse({ ok: true });
      case "CF_AUTOSAVE": {
        // Only pages the user has explicitly marked get a running "Last
        // position". Otherwise this would quietly become a browsing history.
        if (await pageIsTracked(message.draft.url)) {
          await saveCheckpoint({
            ...message.draft,
            id: crypto.randomUUID(),
            key: pageKey(message.draft.url),
          });
        }
        return sendResponse({ ok: true });
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
  void (async () => {
    if (command === "freeze-window") {
      const win = await chrome.windows.getLastFocused();
      if (win.id == null) return;
      const result = await freezeWindow(win.id);
      await flashBadge(result.ok ? String(result.freeze.tabs.length) : "!");
      return;
    }

    if (command === "drop-checkpoint" || command === "drop-flag") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id == null) return;
      const result = await addCheckpoint(tab.id, command === "drop-flag" ? "media" : "position");
      await flashBadge(result.ok ? "+" : "!");
    }
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
