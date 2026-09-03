import type {
  FormFieldValue,
  MediaState,
  PageContext,
  ScrollAnchor,
  SelectionSnapshot,
} from "../types";
import { deepQueryAll } from "./dom";
import { describe, textOf } from "./element-path";

/** Below this many pixels a scroll offset is not worth restoring. */
const MIN_SCROLL_PX = 40;
/** Guard against a runaway page with hundreds of scrollable panes. */
const MAX_NESTED_SCROLLERS = 12;
/** Storage is finite and a contenteditable can hold an essay. */
const MAX_FIELD_CHARS = 20000;
const MAX_SELECTION_CHARS = 500;
/** Ignore a media element parked in the first second - that is just "not started". */
const MIN_MEDIA_SECONDS = 1;

/**
 * Input types we never record. Passwords are the important one: ContextFreeze
 * writes to chrome.storage.local in plaintext, so credentials must never enter it.
 */
const SKIPPED_INPUT_TYPES = new Set([
  "password",
  "hidden",
  "file",
  "submit",
  "button",
  "reset",
  "image",
]);

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  const canScrollY =
    (style.overflowY === "auto" || style.overflowY === "scroll") &&
    el.scrollHeight > el.clientHeight + 10;
  const canScrollX =
    (style.overflowX === "auto" || style.overflowX === "scroll") &&
    el.scrollWidth > el.clientWidth + 10;
  return canScrollY || canScrollX;
}

/**
 * Finds the element sitting at a given viewport point, preferring a leaf-ish
 * node that actually carries text - those are what a reader recognises, and
 * they are far less likely to be a full-height layout wrapper whose top edge
 * tells us nothing about scroll position.
 */
function anchorAtPoint(
  x: number,
  y: number,
  containerTop: number,
  container: Element | null,
): { el: Element; offset: number } | null {
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;

  const stack = [...document.elementsFromPoint(x, y)];
  // elementsFromPoint hands back the shadow HOST, not what is rendered inside
  // it, so step down through open roots at the same point.
  for (let i = 0; i < stack.length; i++) {
    const host = stack[i];
    const inner = host?.shadowRoot?.elementFromPoint(x, y);
    if (inner && inner !== host && !stack.includes(inner)) stack.splice(i, 0, inner);
  }

  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    if (container && !container.contains(el)) continue;
    if (el === document.body || el === document.documentElement) continue;
    if (el.hasAttribute("data-contextfreeze")) continue; // our own overlay
    if (!textOf(el, 10)) continue;
    // A node with many element children is usually a wrapper, not a line of text.
    if (el.childElementCount > 3) continue;
    return { el, offset: el.getBoundingClientRect().top - containerTop };
  }
  return null;
}

/**
 * The very top of the viewport is often an image, a video, a sticky header or a
 * full-height layout wrapper - none of which make usable anchors. Falling back
 * to the raw pixel offset when that happens costs us the whole point of the
 * anchor, so probe a few rows further down before giving up.
 */
const ANCHOR_PROBE_OFFSETS = [8, 48, 120, 240, 400];

function findAnchor(
  x: number,
  top: number,
  height: number,
  container: Element | null,
): { el: Element; offset: number } | null {
  for (const dy of ANCHOR_PROBE_OFFSETS) {
    if (dy > height) break;
    const found = anchorAtPoint(Math.round(x), Math.round(top + dy), top, container);
    if (found) return found;
  }
  return null;
}

/**
 * The document scroller's anchor, with no minimum-scroll threshold.
 *
 * A freeze skips a page that has barely been scrolled - there is nothing worth
 * restoring. A checkpoint must not: dropping one near the top of an article is
 * a deliberate act, and "you were at the top" is the answer the user asked for.
 */
export function describeDocumentScroll(): ScrollAnchor {
  const found = findAnchor(window.innerWidth / 2, 0, window.innerHeight, null);
  return {
    container: null,
    scrollTop: window.scrollY || document.documentElement.scrollTop || 0,
    scrollLeft: window.scrollX || document.documentElement.scrollLeft || 0,
    anchor: found ? describe(found.el) : null,
    anchorText: found ? textOf(found.el) : null,
    anchorOffset: found ? found.offset : 0,
  };
}

/**
 * The one media element a person would call "the video on this page": the
 * biggest one that has actually loaded something.
 *
 * Note what is NOT required: a finite duration. Live streams and any
 * chunked-transfer source report Infinity, and flagging a moment in those is
 * perfectly meaningful.
 */
export function primaryMedia(): { el: HTMLMediaElement; state: MediaState } | null {
  const counts = { video: 0, audio: 0 };
  let best: { el: HTMLMediaElement; state: MediaState; area: number } | null = null;

  for (const el of deepQueryAll<HTMLMediaElement>("video, audio")) {
    const tag = el.tagName.toLowerCase() === "audio" ? "audio" : "video";
    const index = counts[tag]++;
    if (el.readyState < 1 && !el.currentSrc && !el.src) continue;

    const rect = el.getBoundingClientRect();
    const area = Math.max(rect.width * rect.height, tag === "audio" ? 1 : 0);
    if (best && area <= best.area) continue;

    best = {
      el,
      area,
      state: {
        ref: describe(el),
        tag,
        index,
        currentTime: el.currentTime,
        playbackRate: el.playbackRate,
        wasPaused: el.paused,
        duration: Number.isFinite(el.duration) ? el.duration : null,
      },
    };
  }
  return best ? { el: best.el, state: best.state } : null;
}

export function captureScrolls(): ScrollAnchor[] {
  const out: ScrollAnchor[] = [];

  const docTop = window.scrollY || document.documentElement.scrollTop || 0;
  const docLeft = window.scrollX || document.documentElement.scrollLeft || 0;
  if (docTop > MIN_SCROLL_PX || docLeft > MIN_SCROLL_PX) {
    out.push(describeDocumentScroll());
  }

  // Nested scrollers - docs sidebars, chat panes, code viewers. This is the bit
  // plain tab managers never capture, and often the bit you actually lose.
  let found = 0;
  for (const el of deepQueryAll("*")) {
    if (found >= MAX_NESTED_SCROLLERS) break;
    if (el.scrollTop <= MIN_SCROLL_PX && el.scrollLeft <= MIN_SCROLL_PX) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) continue;
    if (!isScrollable(el)) continue;

    const anchor = findAnchor(rect.left + rect.width / 2, rect.top, rect.height, el);
    out.push({
      container: describe(el),
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      anchor: anchor ? describe(anchor.el) : null,
      anchorText: anchor ? textOf(anchor.el) : null,
      anchorOffset: anchor ? anchor.offset : 0,
    });
    found++;
  }

  return out;
}

/**
 * Everything capture cares about, in one selector. Walking the page (and every
 * open shadow root in it) once per element kind would be several full
 * traversals of a large document for no reason.
 */
export const CANDIDATE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], video, audio';

export function collectCandidates(): Element[] {
  return deepQueryAll(CANDIDATE_SELECTOR);
}

function pick<T extends Element>(candidates: Element[], match: (el: Element) => boolean): T[] {
  return candidates.filter(match) as T[];
}

export function captureFields(candidates: Element[] = collectCandidates()): FormFieldValue[] {
  const out: FormFieldValue[] = [];

  for (const el of pick<HTMLInputElement>(candidates, (e) => e instanceof HTMLInputElement)) {
    const type = (el.type || "text").toLowerCase();
    if (SKIPPED_INPUT_TYPES.has(type)) continue;

    if (type === "checkbox" || type === "radio") {
      if (el.checked === el.defaultChecked) continue;
      out.push({
        ref: describe(el),
        kind: "input",
        inputType: type,
        value: el.value,
        checked: el.checked,
      });
      continue;
    }

    // Only worth storing what the user changed from the page's own default.
    if (!el.value || el.value === el.defaultValue) continue;
    out.push({
      ref: describe(el),
      kind: "input",
      inputType: type,
      value: el.value.slice(0, MAX_FIELD_CHARS),
    });
  }

  for (const el of pick<HTMLTextAreaElement>(candidates, (e) => e instanceof HTMLTextAreaElement)) {
    if (!el.value || el.value === el.defaultValue) continue;
    out.push({ ref: describe(el), kind: "textarea", value: el.value.slice(0, MAX_FIELD_CHARS) });
  }

  for (const el of pick<HTMLSelectElement>(candidates, (e) => e instanceof HTMLSelectElement)) {
    const selected: number[] = [];
    let changed = false;
    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options.item(i);
      if (!opt) continue;
      if (opt.selected) selected.push(i);
      if (opt.selected !== opt.defaultSelected) changed = true;
    }
    if (!changed) continue;
    out.push({ ref: describe(el), kind: "select", value: el.value, selectedIndexes: selected });
  }

  for (const el of pick<HTMLElement>(
    candidates,
    (e) => e instanceof HTMLElement && e.isContentEditable,
  )) {
    const html = el.innerHTML;
    if (!html || !el.innerText.trim()) continue;
    out.push({ ref: describe(el), kind: "contenteditable", value: html.slice(0, MAX_FIELD_CHARS) });
  }

  return out;
}

export function captureMedia(candidates: Element[] = collectCandidates()): MediaState[] {
  const out: MediaState[] = [];
  const counts = { video: 0, audio: 0 };
  for (const el of pick<HTMLMediaElement>(candidates, (e) => e instanceof HTMLMediaElement)) {
    const tag = el.tagName.toLowerCase() === "audio" ? "audio" : "video";
    const index = counts[tag]++;
    if (!Number.isFinite(el.currentTime) || el.currentTime < MIN_MEDIA_SECONDS) continue;
    out.push({
      ref: describe(el),
      tag,
      index,
      currentTime: el.currentTime,
      playbackRate: el.playbackRate,
      wasPaused: el.paused,
      duration: Number.isFinite(el.duration) ? el.duration : null,
    });
  }
  return out;
}

function readSelection(): SelectionSnapshot | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const node = sel.anchorNode;
  const el =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);

  return {
    text: text.slice(0, MAX_SELECTION_CHARS),
    ref: el ? describe(el) : null,
    editable: Boolean(el?.closest('[contenteditable=""], [contenteditable="true"]')),
  };
}

let lastSelection: SelectionSnapshot | null = null;
let trackerInstalled = false;

/**
 * Clicking the extension icon takes focus out of the page, and inside a
 * contenteditable that is enough to collapse the selection - so by the time
 * capture runs, the thing the user wanted remembered is already gone. This is
 * why the Gmail highlight came back empty. Remember the last real selection as
 * it happens, and fall back to it.
 */
export function installSelectionTracker(): void {
  if (trackerInstalled) return;
  trackerInstalled = true;
  document.addEventListener(
    "selectionchange",
    () => {
      const snapshot = readSelection();
      if (snapshot) lastSelection = snapshot;
    },
    { passive: true },
  );
}

export function captureSelection(): SelectionSnapshot | null {
  const live = readSelection();
  if (!live && !trackerInstalled) {
    console.warn(
      "[ContextFreeze] installSelectionTracker() was never called, so a " +
        "selection collapsed before capture cannot be recovered.",
    );
  }
  return live ?? lastSelection;
}

export function capturePage(): PageContext {
  const candidates = collectCandidates();
  return {
    url: location.href,
    capturedAt: Date.now(),
    scrolls: captureScrolls(),
    fields: captureFields(candidates),
    media: captureMedia(candidates),
    selection: captureSelection(),
  };
}
