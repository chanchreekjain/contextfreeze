import { capturePage, collectCandidates, isUserVisible } from "./capture";
import { deepQueryAll, shadowRoots } from "./dom";
import { structuralPath } from "./element-path";

/**
 * Says what capture can actually SEE on this page, and what it decided to skip.
 *
 * This exists because three fixes in a row were made by reasoning about what a
 * site probably does, and all three were wrong. A page that will not restore
 * needs to be able to explain itself.
 *
 * It reports shapes, counts and lengths - never the contents of a field. The
 * whole point is that it can be pasted into a chat window safely.
 */

const MAX_LISTED = 25;

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLInputElement) return `input[type=${(el.type || "text").toLowerCase()}]`;
  if (el instanceof HTMLElement && el.isContentEditable) {
    const role = el.getAttribute("role");
    return `${tag}[contenteditable]${role ? `[role=${role}]` : ""}`;
  }
  return tag;
}

function contentLength(el: Element): number {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length;
  if (el instanceof HTMLElement && el.isContentEditable) return el.innerText.trim().length;
  return 0;
}

function inShadow(el: Element): boolean {
  return el.getRootNode() instanceof ShadowRoot;
}

function shadowDepth(el: Element): number {
  let depth = 0;
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    depth++;
    root = root.host.getRootNode();
  }
  return depth;
}

export function diagnose(): string {
  const lines: string[] = [];
  const add = (line = "") => lines.push(line);

  add("ContextFreeze diagnostic");
  add(location.href);
  add(document.title);
  add(`generated ${new Date().toISOString()}`);
  add();

  /* ------------------------------------------------------------------ trees */
  const roots = shadowRoots();
  const deepestRoot = roots.reduce((max, root) => Math.max(max, shadowDepth(root.host) + 1), 0);

  // A custom element with no reachable shadowRoot either uses a CLOSED one, or
  // simply does not use shadow DOM at all - and there is no way to tell which
  // from outside. An earlier version of this report called them all "likely
  // closed roots", which was a guess dressed up as a finding.
  const customElements = deepQueryAll("*").filter((el) => el.tagName.includes("-"));
  const opaque = customElements.filter((el) => !el.shadowRoot);

  const iframes = Array.from(document.querySelectorAll("iframe"));
  let reachableFrames = 0;
  for (const frame of iframes) {
    try {
      if (frame.contentDocument) reachableFrames++;
    } catch {
      /* cross-origin */
    }
  }

  add("TREES");
  add(`  open shadow roots: ${roots.length}${roots.length ? ` (max depth ${deepestRoot})` : ""}`);
  add(`  custom elements: ${customElements.length}, of which ${opaque.length} expose no shadow root`);
  if (opaque.length) {
    const names = [...new Set(opaque.map((el) => el.tagName.toLowerCase()))].slice(0, 8);
    add("    (either no shadow DOM at all, or a closed root - indistinguishable");
    add("     from a content script, so this is not evidence of a problem)");
    add(`    e.g. ${names.join(", ")}`);
  }
  add(`  iframes: ${iframes.length} (${reachableFrames} same-origin, ` +
      `${iframes.length - reachableFrames} cross-origin)`);
  add();

  /* ----------------------------------------------------------------- fields */
  const candidates = collectCandidates();
  const editable = candidates.filter(
    (el) =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable),
  );
  const withContent = editable.filter((el) => contentLength(el) > 0);

  add(`EDITABLE FIELDS FOUND: ${editable.length}, of which ${withContent.length} have content`);
  for (const el of withContent.slice(0, MAX_LISTED)) {
    const where = inShadow(el) ? `shadow depth ${shadowDepth(el)}` : "light";
    const seen = isUserVisible(el) ? "" : "  HIDDEN - not captured";
    add(`  [${where}] ${describeElement(el)}  ${contentLength(el)} chars${seen}`);
    add(`      ${structuralPath(el)}`);
  }
  if (withContent.length > MAX_LISTED) add(`  ...and ${withContent.length - MAX_LISTED} more`);
  add();

  /* ---------------------------------------------------------- what capture did */
  const context = capturePage();
  const kinds = context.fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.kind] = (acc[field.kind] ?? 0) + 1;
    return acc;
  }, {});

  add("WHAT CAPTURE RECORDED");
  add(`  fields: ${context.fields.length}` +
      (context.fields.length
        ? ` (${Object.entries(kinds).map(([k, n]) => `${k} x${n}`).join(", ")})`
        : ""));
  add(`  media: ${context.media.length}`);
  add(`  scroll anchors: ${context.scrolls.length}`);
  add(`  highlight: ${context.selection
    ? `${context.selection.text.length} chars, editable=${context.selection.editable}`
    : "none"}`);
  add();

  /* ------------------------------------------------- what it skipped, and why */
  const capturedPaths = new Set(context.fields.map((f) => f.ref.path));
  const skipped = withContent.filter((el) => !capturedPaths.has(structuralPath(el)));

  add(`SKIPPED DESPITE HAVING CONTENT: ${skipped.length}`);
  for (const el of skipped.slice(0, MAX_LISTED)) {
    let why = "unknown - this is the interesting case";
    if (!isUserVisible(el)) {
      why = "not visible to you - the page's own scratch field, not yours";
    } else if (el instanceof HTMLInputElement) {
      const type = (el.type || "text").toLowerCase();
      if (["password", "hidden", "file", "submit", "button", "reset", "image"].includes(type)) {
        why = `input type "${type}" is never captured, by design`;
      } else if (el.value === el.defaultValue) {
        why = "value still equals the page's own default";
      }
    } else if (el instanceof HTMLTextAreaElement && el.value === el.defaultValue) {
      why = "value still equals the page's own default";
    }
    add(`  [${inShadow(el) ? "shadow" : "light"}] ${describeElement(el)}  ${why}`);
  }
  add();

  add("NOTES");
  add("  A field only counts if you could have typed into it. Pages keep hidden");
  add("  textareas for their own purposes, and those are none of our business.");
  if (iframes.length > reachableFrames) {
    add("  A cross-origin iframe cannot be read from the top frame at all. If the");
    add("  editor you care about lives in one, nothing above will have seen it.");
  }
  if (opaque.length) {
    add("  Closed shadow roots are unreachable from any content script.");
  }
  add("  No field contents appear anywhere in this report - lengths only.");

  return lines.join("\n");
}
