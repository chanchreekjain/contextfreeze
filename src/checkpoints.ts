import type { Checkpoint } from "./types";

const CHECKPOINTS_KEY = "cf_checkpoints";
/** Plenty for a person; keeps storage bounded without ever needing a cleanup UI. */
const MAX_CHECKPOINTS = 500;

/**
 * Groups checkpoints that belong to "the same page".
 *
 * The naive answer - the full URL - is wrong in both directions. On YouTube it
 * splits a video's flags across every `?t=` variant of its URL, so jumping to
 * one flag hides the rest. Elsewhere, tracking params and hashes fragment an
 * article into several pages that are really one.
 */
export function pageKey(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = url.hostname.replace(/^www\./, "");

  // A YouTube video is identified by its id and nothing else.
  if ((host === "youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    if (id) return "youtube:" + id;
  }
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "");
    if (id) return "youtube:" + id;
  }

  for (const param of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|source)/i.test(param)) {
      url.searchParams.delete(param);
    }
  }
  url.hash = "";
  return url.origin + url.pathname.replace(/\/$/, "") + url.search;
}

export async function allCheckpoints(): Promise<Checkpoint[]> {
  const data = await chrome.storage.local.get(CHECKPOINTS_KEY);
  return (data[CHECKPOINTS_KEY] as Checkpoint[] | undefined) ?? [];
}

async function write(all: Checkpoint[]): Promise<void> {
  await chrome.storage.local.set({ [CHECKPOINTS_KEY]: all.slice(0, MAX_CHECKPOINTS) });
}

/** Newest first, but the self-updating "Last position" entry always leads. */
export async function checkpointsForPage(url: string): Promise<Checkpoint[]> {
  const key = pageKey(url);
  const mine = (await allCheckpoints()).filter((c) => c.key === key);
  return mine.sort((a, b) => {
    if (a.auto !== b.auto) return a.auto ? -1 : 1;
    if (a.kind === "media" && b.kind === "media") {
      return (a.media?.currentTime ?? 0) - (b.media?.currentTime ?? 0);
    }
    return b.createdAt - a.createdAt;
  });
}

export async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  const all = await allCheckpoints();
  // One auto entry per page, overwritten rather than stacked.
  const without = checkpoint.auto
    ? all.filter((c) => !(c.auto && c.key === checkpoint.key))
    : all.filter((c) => c.id !== checkpoint.id);
  await write([checkpoint, ...without]);
}

export async function removeCheckpoint(id: string): Promise<void> {
  await write((await allCheckpoints()).filter((c) => c.id !== id));
}

export async function renameCheckpoint(id: string, label: string): Promise<void> {
  await write((await allCheckpoints()).map((c) => (c.id === id ? { ...c, label, auto: false } : c)));
}

/** True once a page is "followed" - i.e. it has at least one manual checkpoint. */
export async function pageIsTracked(url: string): Promise<boolean> {
  const key = pageKey(url);
  return (await allCheckpoints()).some((c) => c.key === key && !c.auto);
}
