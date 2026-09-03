import type { Freeze, PageContext } from "./types";

const FREEZES_KEY = "cf_freezes";
const PENDING_KEY = "cf_pending";

/**
 * A restored tab may sit unloaded in the background for a while before Chrome
 * gets round to running its content script, so pending contexts have to
 * outlive the click that created them by a comfortable margin.
 */
const PENDING_TTL_MS = 30 * 60 * 1000;

export interface PendingRestore {
  url: string;
  context: PageContext;
  queuedAt: number;
}

/** Keyed by tab id, as a string because storage keys are JSON. */
export type PendingMap = Record<string, PendingRestore>;

export async function listFreezes(): Promise<Freeze[]> {
  const data = await chrome.storage.local.get(FREEZES_KEY);
  const freezes = (data[FREEZES_KEY] as Freeze[] | undefined) ?? [];
  return freezes.slice().sort((a, b) => b.createdAt - a.createdAt);
}

async function writeFreezes(freezes: Freeze[]): Promise<void> {
  await chrome.storage.local.set({ [FREEZES_KEY]: freezes });
}

export async function saveFreeze(freeze: Freeze): Promise<void> {
  const all = await listFreezes();
  await writeFreezes([freeze, ...all]);
}

export async function getFreeze(id: string): Promise<Freeze | null> {
  const all = await listFreezes();
  return all.find((f) => f.id === id) ?? null;
}

export async function removeFreeze(id: string): Promise<void> {
  const all = await listFreezes();
  await writeFreezes(all.filter((f) => f.id !== id));
}

export async function renameFreeze(id: string, name: string): Promise<void> {
  const all = await listFreezes();
  await writeFreezes(all.map((f) => (f.id === id ? { ...f, name } : f)));
}

/** Reads the pending map, dropping anything that has gone stale. */
export async function getPending(): Promise<PendingMap> {
  const data = await chrome.storage.session.get(PENDING_KEY);
  const map = (data[PENDING_KEY] as PendingMap | undefined) ?? {};
  const now = Date.now();
  let pruned = false;
  for (const key of Object.keys(map)) {
    const entry = map[key];
    if (!entry || now - entry.queuedAt > PENDING_TTL_MS) {
      delete map[key];
      pruned = true;
    }
  }
  if (pruned) await setPending(map);
  return map;
}

export async function setPending(map: PendingMap): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: map });
}
