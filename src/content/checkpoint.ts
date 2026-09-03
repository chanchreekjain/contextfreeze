import type { Checkpoint, CheckpointKind, ScrollAnchor } from "../types";
import { describeDocumentScroll, primaryMedia } from "./capture";
import { applyScroll, resolveMedia, seek } from "./restore";

/** A jump into a page that is already open should feel instant, so try hard, briefly. */
const JUMP_MAX_WAIT_MS = 8_000;
const JUMP_ANCHOR_ONLY_MS = 2_000;
const JUMP_FIRST_DELAY_MS = 80;
const JUMP_MAX_DELAY_MS = 600;
const JUMP_SETTLE_PASSES = 3;
const JUMP_SETTLE_INTERVAL_MS = 350;
const HAVE_METADATA = 1;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function clockLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function positionLabel(scroll: ScrollAnchor): string {
  const text = scroll.anchorText?.trim();
  if (text) return text.length > 60 ? text.slice(0, 60).trimEnd() + "..." : text;
  return scroll.scrollTop < 40 ? "Top of page" : `${Math.round(scroll.scrollTop)}px down`;
}

/** What the popup and the keyboard shortcut both call. Returns null if there is nothing to mark. */
export function dropCheckpoint(kind: CheckpointKind, auto = false): Omit<Checkpoint, "id" | "key"> | null {
  if (kind === "media") {
    const found = primaryMedia();
    if (!found) return null;
    return {
      url: location.href,
      title: document.title,
      label: clockLabel(found.state.currentTime),
      kind: "media",
      auto,
      createdAt: Date.now(),
      media: found.state,
    };
  }

  const scroll = describeDocumentScroll();
  return {
    url: location.href,
    title: document.title,
    label: auto ? "Last position" : positionLabel(scroll),
    kind: "position",
    auto,
    createdAt: Date.now(),
    scroll,
  };
}

/**
 * Jumping inside a page that is already loaded is the easy case and usually
 * lands on the first try. The same code covers the hard case - the tab has just
 * been navigated here and the content is still arriving - by retrying, with the
 * same rule the full restore uses: no raw pixel fallback until the anchor has
 * had a fair chance to win.
 */
export async function jumpTo(checkpoint: Checkpoint): Promise<boolean> {
  const started = Date.now();

  if (checkpoint.kind === "media" && checkpoint.media) {
    const state = checkpoint.media;
    let delay = JUMP_FIRST_DELAY_MS;
    while (Date.now() - started < JUMP_MAX_WAIT_MS) {
      const el = resolveMedia(state);
      if (el && el.readyState >= HAVE_METADATA) {
        // rewind 0: you marked this exact moment.
        seek(el, state, 0);
        return true;
      }
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.6), JUMP_MAX_DELAY_MS);
    }
    return false;
  }

  const scroll = checkpoint.scroll;
  if (!scroll) return false;

  let landed = false;
  let delay = JUMP_FIRST_DELAY_MS;
  while (!landed && Date.now() - started < JUMP_MAX_WAIT_MS) {
    landed = applyScroll(scroll, Date.now() - started > JUMP_ANCHOR_ONLY_MS);
    if (landed) break;
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.6), JUMP_MAX_DELAY_MS);
  }
  if (!landed) return false;

  for (let pass = 0; pass < JUMP_SETTLE_PASSES; pass++) {
    await sleep(JUMP_SETTLE_INTERVAL_MS);
    applyScroll(scroll, true);
  }
  return true;
}
