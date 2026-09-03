import type {
  FormFieldValue,
  MediaState,
  PageContext,
  RestoreReport,
  ScrollAnchor,
  SelectionSnapshot,
  UnrestoredField,
} from "../types";
import { RESUME_REWIND_SECONDS } from "../constants";
import { deepQueryAll, shadowRoots } from "./dom";
import { resolve, textOf } from "./element-path";
import { findTextRange } from "./text-range";

/**
 * Give up after this long. Generous, because a heavy SPA restoring its own state
 * (Gmail reopening a draft compose) can take many seconds to put the text back,
 * and the loop costs one cheap sweep a second once it has backed off.
 */
const MAX_WAIT_MS = 30_000;
/**
 * For the first few seconds we insist on the anchor and refuse the raw pixel
 * fallback. Otherwise the fallback always wins the race - the document is tall
 * enough to accept `scrollTo` long before the content the user cared about has
 * rendered, and we would land in the wrong place every single time.
 */
const ANCHOR_ONLY_MS = 3_000;
const FIRST_DELAY_MS = 120;
const MAX_DELAY_MS = 1_000;
/** Lazy content keeps shifting after we scroll, so nudge a few more times. */
const SETTLE_PASSES = 4;
const SETTLE_INTERVAL_MS = 450;
/** Do not fight the page over sub-pixel drift. */
const SCROLL_TOLERANCE_PX = 4;
const HAVE_METADATA = 1;
/** How long to keep an eye on a player that might reset the playhead under us. */
const MEDIA_GUARD_MS = 12_000;
const MEDIA_GUARD_INTERVAL_MS = 400;
const MAX_SEEK_CORRECTIONS = 8;
/** Only intervene if the player threw us properly backwards, not by a rounding error. */
const MEDIA_DRIFT_TOLERANCE_S = 5;

const HIGHLIGHT_NAME = "contextfreeze";
const HIGHLIGHT_STYLE_ID = "contextfreeze-highlight-style";
/** How long to keep putting a caret selection back while an SPA settles. */
const SELECTION_GUARD_MS = 8_000;
const SELECTION_GUARD_INTERVAL_MS = 500;
const MAX_SELECTION_CORRECTIONS = 8;
/** Enough to hand back a lost comment; not so much that storage balloons. */
const MAX_UNRESTORED = 8;
const MAX_UNRESTORED_CHARS = 20_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ fields */

/**
 * React (and Vue, and Svelte) keep their own copy of an input's value and will
 * overwrite a plain `el.value = x` on the next render. Going through the
 * prototype's native setter and then dispatching a bubbling `input` event is
 * what makes the framework accept the change as if the user had typed it.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function notify(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyField(field: FormFieldValue): boolean {
  const el = resolve(field.ref);
  if (!el) return false;

  if (field.kind === "contenteditable") {
    if (!(el instanceof HTMLElement) || !el.isContentEditable) return false;
    el.innerHTML = field.value;
    notify(el);
    return true;
  }

  if (el instanceof HTMLSelectElement) {
    const wanted = new Set(field.selectedIndexes ?? []);
    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options.item(i);
      if (opt) opt.selected = wanted.has(i);
    }
    notify(el);
    return true;
  }

  if (el instanceof HTMLInputElement) {
    if (field.inputType === "checkbox" || field.inputType === "radio") {
      // Set the property directly - dispatching a click would toggle it back.
      el.checked = Boolean(field.checked);
      notify(el);
      return true;
    }
    setNativeValue(el, field.value);
    notify(el);
    return true;
  }

  if (el instanceof HTMLTextAreaElement) {
    setNativeValue(el, field.value);
    notify(el);
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------- media */

const seekPending = new WeakSet<HTMLMediaElement>();
const guarded = new WeakSet<HTMLMediaElement>();

/**
 * A player's DOM path is the least reliable thing about it - YouTube rebuilds
 * its player subtree on every load, so the structural path captured at freeze
 * time routinely resolves to nothing. Try the recorded ref, then "the only
 * <video> on the page", then the ordinal.
 */
export function resolveMedia(state: MediaState): HTMLMediaElement | null {
  const byRef = resolve(state.ref);
  if (byRef instanceof HTMLMediaElement) return byRef;

  const sameTag = deepQueryAll<HTMLMediaElement>(state.tag);
  if (sameTag.length === 1) return sameTag[0] ?? null;
  return sameTag[state.index] ?? null;
}

function targetTime(state: MediaState, rewind: number): number {
  return Math.max(0, state.currentTime - rewind);
}

/**
 * `rewind` defaults to the resume rewind, because picking a video back up
 * mid-sentence is jarring. Jumping to a flag you placed deliberately passes 0 -
 * you marked that moment, not three seconds before it.
 */
export function seek(el: HTMLMediaElement, state: MediaState, rewind = RESUME_REWIND_SECONDS): void {
  try {
    const limit = Number.isFinite(el.duration) ? el.duration - 0.25 : Infinity;
    el.currentTime = Math.max(0, Math.min(targetTime(state, rewind), limit));
    el.playbackRate = state.playbackRate;
    // Never auto-play. Coming back to a frozen window should not start audio.
  } catch {
    /* some players reject seeks until they are ready; the retry loop covers it */
  }
}

/**
 * One seek is not enough. Site players initialise asynchronously and reset
 * currentTime to their own idea of the start AFTER we have seeked, so the
 * playhead silently snaps back to zero a second later. Watch the element for a
 * few seconds and put it back - bounded, and only while the user is hands-off.
 */
function guardSeek(el: HTMLMediaElement, state: MediaState, isAborted: () => boolean): void {
  if (guarded.has(el)) return;
  guarded.add(el);

  const wanted = targetTime(state, RESUME_REWIND_SECONDS);
  const floor = Math.max(1, wanted - MEDIA_DRIFT_TOLERANCE_S);
  const deadline = Date.now() + MEDIA_GUARD_MS;
  let corrections = 0;

  const timer = setInterval(() => {
    if (isAborted() || !el.isConnected || Date.now() > deadline || corrections >= MAX_SEEK_CORRECTIONS) {
      clearInterval(timer);
      return;
    }
    // Playing forward is normal, and a user seeking elsewhere is none of our
    // business. Only a jump backwards past the floor means the player reset us.
    if (el.currentTime < floor) {
      corrections++;
      seek(el, state);
    }
  }, MEDIA_GUARD_INTERVAL_MS);
}

function applyMedia(state: MediaState, isAborted: () => boolean): boolean {
  const el = resolveMedia(state);
  if (!el) return false;

  if (el.readyState < HAVE_METADATA) {
    // Duration is unknown, so a seek would be clamped to 0. Wait for metadata,
    // but register the listener only once however many times we retry.
    if (!seekPending.has(el)) {
      seekPending.add(el);
      el.addEventListener("loadedmetadata", () => {
        seek(el, state);
        guardSeek(el, state, isAborted);
      }, { once: true });
    }
    return false;
  }

  seek(el, state);
  guardSeek(el, state, isAborted);
  return true;
}

/* ------------------------------------------------------------------ scroll */

function scrollerFor(anchor: ScrollAnchor): Element | Window | null {
  if (!anchor.container) return window;
  return resolve(anchor.container);
}

function currentTop(scroller: Element | Window): number {
  return scroller === window
    ? window.scrollY
    : (scroller as Element).scrollTop;
}

function scrollTo(scroller: Element | Window, top: number, left: number): void {
  // "instant" matters: plenty of sites set `scroll-behavior: smooth` globally,
  // and an animated restore both looks broken and confuses the settle passes.
  const options: ScrollToOptions = { top, left, behavior: "instant" };
  if (scroller === window) window.scrollTo(options);
  else (scroller as Element).scrollTo(options);
}

/** How far the anchor currently is from where it should be, or null if unusable. */
function anchorDrift(anchor: ScrollAnchor, scroller: Element | Window): number | null {
  if (!anchor.anchor) return null;
  const el = resolve(anchor.anchor);
  if (!el) return null;

  // Cheap guard against the path resolving to a different element after a
  // layout change: the text should still look like what we captured.
  if (anchor.anchorText) {
    const now = textOf(el);
    const head = anchor.anchorText.slice(0, 30);
    if (head && !now.startsWith(head) && !anchor.anchorText.startsWith(now.slice(0, 30))) {
      return null;
    }
  }

  const top = el.getBoundingClientRect().top;
  const containerTop =
    scroller === window ? 0 : (scroller as Element).getBoundingClientRect().top;
  return top - containerTop - anchor.anchorOffset;
}

export function applyScroll(anchor: ScrollAnchor, allowPixelFallback: boolean): boolean {
  const scroller = scrollerFor(anchor);
  if (!scroller) return false;

  const drift = anchorDrift(anchor, scroller);
  if (drift !== null) {
    if (Math.abs(drift) > SCROLL_TOLERANCE_PX) {
      scrollTo(scroller, currentTop(scroller) + drift, anchor.scrollLeft);
    }
    return true;
  }

  if (!allowPixelFallback) return false;

  const el = scroller === window ? document.documentElement : (scroller as Element);
  const maxTop = el.scrollHeight - el.clientHeight;
  if (maxTop < anchor.scrollTop) return false; // not tall enough yet - wait
  scrollTo(scroller, anchor.scrollTop, anchor.scrollLeft);
  return true;
}

/* --------------------------------------------------------------- selection */

interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

/**
 * Paint the highlight with the CSS Custom Highlight API rather than restoring a
 * native selection.
 *
 * A native selection loses every fight: the first click clears it, and an SPA
 * that calls focus() on load (Gmail opening a compose window, for one) clears it
 * before you ever see it. A custom highlight is not a selection, so nothing
 * clears it - and it mutates no DOM, so no page's own code trips over it.
 */
function paintHighlight(range: Range): boolean {
  const ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight;
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  if (!ctor || !registry) return false;

  const rule = "::highlight(" + HIGHLIGHT_NAME + "){background:#ffe066;color:#000;}";
  const addStyle = (target: Document | ShadowRoot) => {
    if (target.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = rule;
    (target === document ? document.head : (target as ShadowRoot)).appendChild(style);
  };
  addStyle(document);
  // A highlight registry is global, but the ::highlight() rule is not - it has
  // to exist inside the tree that owns the range, or nothing is painted.
  const rangeRoot = range.startContainer.getRootNode();
  if (rangeRoot instanceof ShadowRoot) addStyle(rangeRoot);
  registry.set(HIGHLIGHT_NAME, new ctor(range));

  // Step aside as soon as the USER highlights something of their own.
  //
  // Two traps here. Not { once: true }: collapsed selection changes fire
  // constantly (restoring a form field is enough) and would eat the listener
  // before it ever mattered. And not on any non-collapsed selection either:
  // plenty of pages select their own text programmatically while booting, and
  // that must not count - so wait for a real gesture first.
  let userActed = false;
  const noteGesture = () => { userActed = true; };
  const gestureOptions = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", noteGesture, gestureOptions);
  document.addEventListener("keydown", noteGesture, gestureOptions);

  const onSelectionChange = () => {
    if (!userActed) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      registry.delete(HIGHLIGHT_NAME);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", noteGesture, { capture: true });
      document.removeEventListener("keydown", noteGesture, { capture: true });
    }
  };
  document.addEventListener("selectionchange", onSelectionChange);
  return true;
}

function editableHost(node: Node | null): HTMLElement | null {
  const el =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  const host = el?.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"]');
  return host?.isContentEditable ? host : null;
}

function selectRange(range: Range): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * An SPA keeps meddling after we are done: Gmail focuses the compose box, moves
 * the caret to the end and collapses whatever we set. So a selection inside an
 * editor has to be re-asserted for a few seconds - bounded, and dropped the
 * moment the user does anything.
 */
function guardSelection(
  host: HTMLElement,
  snapshot: SelectionSnapshot,
  isAborted: () => boolean,
): void {
  const deadline = Date.now() + SELECTION_GUARD_MS;
  let corrections = 0;

  const timer = setInterval(() => {
    if (isAborted() || !host.isConnected || Date.now() > deadline ||
        corrections >= MAX_SELECTION_CORRECTIONS) {
      clearInterval(timer);
      return;
    }
    const current = window.getSelection();
    if (current && !current.isCollapsed && current.toString().includes(snapshot.text.slice(0, 20))) {
      return; // still ours, nothing to do
    }
    const range = findTextRange(host, snapshot.text);
    if (!range) return;
    corrections++;
    host.focus({ preventScroll: true });
    selectRange(range);
  }, SELECTION_GUARD_INTERVAL_MS);
}

function applySelection(
  snapshot: SelectionSnapshot,
  hasScrollToRestore: boolean,
  isAborted: () => boolean,
): boolean {
  const scope = (snapshot.ref ? resolve(snapshot.ref) : null) ?? document.body;
  if (!scope) return false;

  let range = findTextRange(scope, snapshot.text);
  if (!range && scope === document.body) {
    // The text may live inside a web component. Light DOM first, because it is
    // far cheaper and is where the text usually is.
    for (const root of shadowRoots()) {
      range = findTextRange(root, snapshot.text);
      if (range) break;
    }
  }
  if (!range) return false;

  // Inside an editor you are coming back to *edit*, so a real focused selection
  // is what you want. Everywhere else a painted highlight is better, because a
  // native selection is cleared by the first click.
  const host = snapshot.editable ? editableHost(range.startContainer) : null;
  if (host) {
    host.focus({ preventScroll: true });
    if (!selectRange(range)) return false;
    guardSelection(host, snapshot, isAborted);
  } else if (!paintHighlight(range)) {
    if (!selectRange(range)) return false;
  }

  // Nothing else is going to move the viewport, so bring the mark into view.
  if (!hasScrollToRestore) {
    const rect = range.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight) {
      range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }
  return true;
}

/* ------------------------------------------------------------------- entry */

/**
 * The whole restore is a retry loop rather than a one-shot on DOMContentLoaded,
 * because on any modern site DOMContentLoaded fires long before the content our
 * anchors point at actually exists. We keep trying each outstanding item,
 * backing off, until everything lands or we run out of patience.
 */
export async function restorePage(context: PageContext): Promise<RestoreReport> {
  const started = Date.now();

  const pendingFields = [...context.fields];
  const pendingMedia = [...context.media];
  const pendingScrolls = [...context.scrolls];
  const landedScrolls: ScrollAnchor[] = [];
  let selection = context.selection;

  const totals = {
    fields: context.fields.length,
    media: context.media.length,
    scrolls: context.scrolls.length,
  };
  const done = { fields: 0, media: 0, scrolls: 0 };

  // If the user starts interacting, stop yanking the page around under them.
  let aborted = false;
  const abort = () => { aborted = true; };
  const abortEvents = ["wheel", "keydown", "mousedown", "touchstart"] as const;
  for (const name of abortEvents) {
    window.addEventListener(name, abort, { passive: true, capture: true, once: true });
  }

  const isAborted = () => aborted;
  const hasScrollToRestore = context.scrolls.length > 0;

  const sweep = (allowPixelFallback: boolean) => {
    for (let i = pendingFields.length - 1; i >= 0; i--) {
      const field = pendingFields[i];
      if (field && applyField(field)) {
        pendingFields.splice(i, 1);
        done.fields++;
      }
    }
    for (let i = pendingMedia.length - 1; i >= 0; i--) {
      const media = pendingMedia[i];
      if (media && applyMedia(media, isAborted)) {
        pendingMedia.splice(i, 1);
        done.media++;
      }
    }
    // Scroll last: filling a field can change layout above the fold.
    for (let i = pendingScrolls.length - 1; i >= 0; i--) {
      const anchor = pendingScrolls[i];
      if (anchor && applyScroll(anchor, allowPixelFallback)) {
        pendingScrolls.splice(i, 1);
        landedScrolls.push(anchor);
        done.scrolls++;
      }
    }
    if (selection && applySelection(selection, hasScrollToRestore, isAborted)) selection = null;
  };

  let delay = FIRST_DELAY_MS;
  while (
    !aborted &&
    Date.now() - started < MAX_WAIT_MS &&
    (pendingFields.length || pendingMedia.length || pendingScrolls.length || selection)
  ) {
    sweep(Date.now() - started > ANCHOR_ONLY_MS);
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.6), MAX_DELAY_MS);
  }
  if (!aborted) sweep(true);

  // Settle: images finish loading and ads inject themselves after we scrolled,
  // pushing our anchor off screen again. Re-nudge a few times before letting go.
  for (let pass = 0; pass < SETTLE_PASSES && !aborted && landedScrolls.length; pass++) {
    await sleep(SETTLE_INTERVAL_MS);
    if (aborted) break;
    for (const anchor of landedScrolls) {
      const scroller = scrollerFor(anchor);
      if (!scroller) continue;
      const drift = anchorDrift(anchor, scroller);
      if (drift !== null && Math.abs(drift) > SCROLL_TOLERANCE_PX) {
        scrollTo(scroller, currentTop(scroller) + drift, anchor.scrollLeft);
      }
    }
  }

  for (const name of abortEvents) {
    window.removeEventListener(name, abort, { capture: true });
  }

  // Anything we could not put back is handed out rather than dropped. A draft
  // comment that vanishes silently is the worst thing this extension could do.
  const unrestored: UnrestoredField[] = pendingFields
    .filter((field) => field.value.trim().length > 0)
    .slice(0, MAX_UNRESTORED)
    .map((field) => ({
      label: field.ref.id ?? field.ref.name ?? field.kind,
      kind: field.kind,
      value: field.value.slice(0, MAX_UNRESTORED_CHARS),
    }));

  const report: RestoreReport = {
    url: location.href,
    scrolls: [done.scrolls, totals.scrolls],
    fields: [done.fields, totals.fields],
    media: [done.media, totals.media],
    selection: [context.selection && !selection ? 1 : 0, context.selection ? 1 : 0],
    unrestored,
    aborted,
    elapsedMs: Date.now() - started,
  };

  // Deliberately loud. When something does not come back, the first question is
  // always "was it not captured, or not restored?" - and this answers it.
  console.debug("[ContextFreeze] restored", {
    scroll: report.scrolls.join("/"),
    fields: report.fields.join("/"),
    media: report.media.join("/"),
    highlight: report.selection.join("/"),
    aborted,
    ms: report.elapsedMs,
    unresolved: {
      scrolls: pendingScrolls.map((a) => a.anchor?.id ?? a.anchor?.path ?? "(pixel only)"),
      fields: pendingFields.map((f) => f.ref.id ?? f.ref.name ?? f.kind),
      media: pendingMedia.map((m) => m.ref.id ?? `${m.tag}[${m.index}]`),
      highlight: selection ? selection.text.slice(0, 40) : null,
    },
  });

  return report;
}
