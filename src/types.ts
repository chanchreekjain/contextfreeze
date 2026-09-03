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

/** What actually made it back, so the UI can be honest about partial restores. */
export interface RestoreReport {
  url: string;
  scrolls: [restored: number, total: number];
  fields: [restored: number, total: number];
  media: [restored: number, total: number];
  elapsedMs: number;
}
