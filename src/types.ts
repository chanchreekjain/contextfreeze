/**
 * ContextFreeze does NOT serialise the DOM. It reloads the real page and then
 * re-applies a small "context layer" describing where the user was inside it.
 * Everything in this file is that context layer.
 */

/**
 * A way to find an element again after a reload. We record several strategies
 * because each one breaks under different kinds of page change:
 *   - `id`   survives re-ordering but not re-generated ids (styled-components etc.)
 *   - `name` survives re-ordering, and is what most real forms use
 *   - `path` survives id churn but not structural change
 * On restore we try them in that order.
 */
export interface ElementRef {
  id?: string;
  name?: string;
  path: string;
}

/**
 * Where a scroll container was parked.
 *
 * `scrollTop` alone is unreliable: lazy images, infinite scroll and responsive
 * reflow all change what lives at a given pixel offset. So we also record the
 * element that was sitting at the top of the viewport, and prefer to scroll
 * that element back into the same place. The pixel offset is the fallback.
 */
export interface ScrollAnchor {
  /** null means the document scroller rather than a nested one. */
  container: ElementRef | null;
  scrollTop: number;
  scrollLeft: number;
  anchor: ElementRef | null;
  /** Used to sanity-check that the anchor still holds the same content. */
  anchorText: string | null;
  /** Distance in px from the top of the container to the top of the anchor. */
  anchorOffset: number;
}

export type FieldKind = "input" | "textarea" | "select" | "contenteditable";

export interface FormFieldValue {
  ref: ElementRef;
  kind: FieldKind;
  /** The input's `type` attribute, lowercased. Absent for non-inputs. */
  inputType?: string;
  value: string;
  checked?: boolean;
  selectedIndexes?: number[];
}

export interface MediaState {
  ref: ElementRef;
  tag: "video" | "audio";
  /**
   * Position among the page's media elements of the same tag. Video players
   * (YouTube above all) rebuild their DOM on every load, so the structural path
   * captured at freeze time routinely fails to resolve. The ordinal is a much
   * better bet, and "the only <video> on the page" is better still.
   */
  index: number;
  currentTime: number;
  playbackRate: number;
  /** Recorded for information only - restore never auto-plays. */
  wasPaused: boolean;
  duration: number | null;
}

export interface SelectionSnapshot {
  text: string;
  ref: ElementRef | null;
  /**
   * True when the text was selected inside a contenteditable (a compose box, a
   * rich editor). Those restore as a real focused selection - you are coming
   * back to edit. Everything else restores as a painted highlight.
   */
  editable: boolean;
}

export interface PageContext {
  url: string;
  capturedAt: number;
  scrolls: ScrollAnchor[];
  fields: FormFieldValue[];
  media: MediaState[];
  selection: SelectionSnapshot | null;
}

export interface FrozenTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  index: number;
  active: boolean;
  groupTitle?: string;
  groupColor?: string;
  /** null when the page could not be read (chrome://, Web Store, PDF viewer...). */
  context: PageContext | null;
  captureError?: string;
}

export interface Freeze {
  id: string;
  name: string;
  createdAt: number;
  tabs: FrozenTab[];
}

/**
 * Text that was captured but could not be put back - the field is gone, or the
 * page never rebuilt it. Carried out of the restore so the popup can hand it
 * over rather than dropping it on the floor.
 */
export interface UnrestoredField {
  label: string;
  kind: FieldKind;
  value: string;
}

/** What actually made it back, so the UI can be honest about partial restores. */
export interface RestoreReport {
  url: string;
  scrolls: [restored: number, total: number];
  fields: [restored: number, total: number];
  media: [restored: number, total: number];
  selection: [restored: number, total: number];
  /** Text we captured and failed to restore. Never silently discarded. */
  unrestored: UnrestoredField[];
  /** True when the user took over and we stood down before finishing. */
  aborted: boolean;
  elapsedMs: number;
}

/* ------------------------------------------------------------- checkpoints */

/**
 * A checkpoint is a single named place inside one page, rather than a whole
 * window's worth of state. Two flavours:
 *
 *   position - somewhere in an article, recorded the same way a freeze records
 *              scroll: an anchor element plus an offset, never a raw pixel.
 *   media    - a flag at a moment in a video or podcast.
 *
 * `auto` marks the self-updating "Last position" entry a page keeps once you
 * have dropped at least one checkpoint on it. It is overwritten, never stacked.
 */
export type CheckpointKind = "position" | "media";

export interface Checkpoint {
  id: string;
  /** Normalised page key - see pageKey(). Flags on one video share a key. */
  key: string;
  url: string;
  title: string;
  label: string;
  kind: CheckpointKind;
  auto: boolean;
  createdAt: number;
  scroll?: ScrollAnchor;
  media?: MediaState;
}
