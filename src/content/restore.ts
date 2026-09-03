import type {
  FormFieldValue,
  MediaState,
  PageContext,
  RestoreReport,
  ScrollAnchor,
  SelectionSnapshot,
} from "../types";
import { resolve, textOf } from "./element-path";
import { findTextRange } from "./text-range";

/** Give up after this long. A page that has not rendered by now is not going to. */
const MAX_WAIT_MS = 15_000;
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

function seek(el: HTMLMediaElement, state: MediaState): void {
  try {
    const limit = Number.isFinite(el.duration) ? el.duration - 0.25 : Infinity;
    el.currentTime = Math.max(0, Math.min(state.currentTime, limit));
    el.playbackRate = state.playbackRate;
    // Never auto-play. Coming back to a frozen window should not start audio.
  } catch {
    /* some players reject seeks until they are ready; the retry loop covers it */
  }
}

function applyMedia(state: MediaState): boolean {
  const el = resolve(state.ref);
  if (!(el instanceof HTMLMediaElement)) return false;

  if (el.readyState < HAVE_METADATA) {
    // Duration is unknown, so a seek would be clamped to 0. Wait for metadata,
    // but register the listener only once however many times we retry.
    if (!seekPending.has(el)) {
      seekPending.add(el);
      el.addEventListener("loadedmetadata", () => seek(el, state), { once: true });
    }
    return false;
  }

  seek(el, state);
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

function applyScroll(anchor: ScrollAnchor, allowPixelFallback: boolean): boolean {
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

function applySelection(snapshot: SelectionSnapshot): boolean {
  const scope = (snapshot.ref ? resolve(snapshot.ref) : null) ?? document.body;
  if (!scope) return false;

  const range = findTextRange(scope, snapshot.text);
  if (!range) return false;

  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
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
      if (media && applyMedia(media)) {
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
    if (selection && applySelection(selection)) selection = null;
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

  return {
    url: location.href,
    scrolls: [done.scrolls, totals.scrolls],
    fields: [done.fields, totals.fields],
    media: [done.media, totals.media],
    elapsedMs: Date.now() - started,
  };
}
