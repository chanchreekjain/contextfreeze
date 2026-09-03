import type {
  FormFieldValue,
  MediaState,
  PageContext,
  ScrollAnchor,
  SelectionSnapshot,
} from "../types";
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

  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    if (container && !container.contains(el)) continue;
    if (el === document.body || el === document.documentElement) continue;
    if (!textOf(el, 10)) continue;
    // A node with many element children is usually a wrapper, not a line of text.
    if (el.childElementCount > 3) continue;
    return { el, offset: el.getBoundingClientRect().top - containerTop };
  }
  return null;
}

export function captureScrolls(): ScrollAnchor[] {
  const out: ScrollAnchor[] = [];

  const docTop = window.scrollY || document.documentElement.scrollTop || 0;
  const docLeft = window.scrollX || document.documentElement.scrollLeft || 0;
  if (docTop > MIN_SCROLL_PX || docLeft > MIN_SCROLL_PX) {
    const found = anchorAtPoint(Math.round(window.innerWidth / 2), 8, 0, null);
    out.push({
      container: null,
      scrollTop: docTop,
      scrollLeft: docLeft,
      anchor: found ? describe(found.el) : null,
      anchorText: found ? textOf(found.el) : null,
      anchorOffset: found ? found.offset : 0,
    });
  }

  // Nested scrollers - docs sidebars, chat panes, code viewers. This is the bit
  // plain tab managers never capture, and often the bit you actually lose.
  let found = 0;
  for (const el of document.querySelectorAll("*")) {
    if (found >= MAX_NESTED_SCROLLERS) break;
    if (el.scrollTop <= MIN_SCROLL_PX && el.scrollLeft <= MIN_SCROLL_PX) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) continue;
    if (!isScrollable(el)) continue;

    const anchor = anchorAtPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + 8),
      rect.top,
      el,
    );
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

export function captureFields(): FormFieldValue[] {
  const out: FormFieldValue[] = [];

  for (const el of document.querySelectorAll("input")) {
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

  for (const el of document.querySelectorAll("textarea")) {
    if (!el.value || el.value === el.defaultValue) continue;
    out.push({ ref: describe(el), kind: "textarea", value: el.value.slice(0, MAX_FIELD_CHARS) });
  }

  for (const el of document.querySelectorAll("select")) {
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

  for (const el of document.querySelectorAll<HTMLElement>('[contenteditable=""], [contenteditable="true"]')) {
    const html = el.innerHTML;
    if (!html || !el.innerText.trim()) continue;
    out.push({ ref: describe(el), kind: "contenteditable", value: html.slice(0, MAX_FIELD_CHARS) });
  }

  return out;
}

export function captureMedia(): MediaState[] {
  const out: MediaState[] = [];
  for (const el of document.querySelectorAll<HTMLMediaElement>("video, audio")) {
    if (!Number.isFinite(el.currentTime) || el.currentTime < MIN_MEDIA_SECONDS) continue;
    out.push({
      ref: describe(el),
      tag: el.tagName.toLowerCase() === "audio" ? "audio" : "video",
      currentTime: el.currentTime,
      playbackRate: el.playbackRate,
      wasPaused: el.paused,
      duration: Number.isFinite(el.duration) ? el.duration : null,
    });
  }
  return out;
}

export function captureSelection(): SelectionSnapshot | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const node = sel.anchorNode;
  const el =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);

  return { text: text.slice(0, MAX_SELECTION_CHARS), ref: el ? describe(el) : null };
}

export function capturePage(): PageContext {
  return {
    url: location.href,
    capturedAt: Date.now(),
    scrolls: captureScrolls(),
    fields: captureFields(),
    media: captureMedia(),
    selection: captureSelection(),
  };
}
