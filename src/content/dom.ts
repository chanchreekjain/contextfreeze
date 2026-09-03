/**
 * Traversal that crosses open shadow boundaries.
 *
 * `document.querySelectorAll` stops dead at a shadow root, and a large slice of
 * the modern web puts its editors inside one - Reddit's comment composer is a
 * web component, so a draft comment was completely invisible to capture. Not a
 * subtle bug: the field was never seen, so there was nothing to restore.
 *
 * Closed shadow roots stay unreachable. Nothing can be done about those from a
 * content script, and pretending otherwise would just fail more quietly.
 */

/** Elements scanned before we stop looking. Generous; a guard, not a policy. */
const SCAN_BUDGET = 250_000;
/** Nesting depth of shadow roots. Real component trees are nowhere near this. */
const MAX_DEPTH = 12;

function walk(
  root: ParentNode,
  selector: string,
  found: Element[],
  budget: { left: number },
  depth: number,
): void {
  if (depth > MAX_DEPTH || budget.left <= 0) return;

  for (const el of root.querySelectorAll(selector)) found.push(el);

  // One pass for hosts. Doing this per-selector would mean re-walking the whole
  // document for every kind of element we are looking for.
  for (const el of root.querySelectorAll("*")) {
    if (--budget.left <= 0) return;
    // Never descend into our own overlay: it has a shadow root and an input,
    // and capturing that would restore ContextFreeze's own UI into your page.
    if (el.hasAttribute("data-contextfreeze")) continue;
    if (el.shadowRoot) walk(el.shadowRoot, selector, found, budget, depth + 1);
  }
}

/** querySelectorAll, but it descends into every open shadow root it meets. */
export function deepQueryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  const found: Element[] = [];
  walk(root, selector, found, { left: SCAN_BUDGET }, 0);
  return found as T[];
}

/** First match anywhere, shadow roots included. */
export function deepQuery<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return (deepQueryAll<T>(selector, root)[0] as T | undefined) ?? null;
}

/** Every open shadow root on the page, outermost first. */
export function shadowRoots(root: ParentNode = document): ShadowRoot[] {
  const hosts = deepQueryAll("*", root).filter((el) => el.shadowRoot);
  return hosts.map((el) => el.shadowRoot as ShadowRoot);
}

/** The tree an element actually lives in - its shadow root, or the document. */
export function treeOf(el: Node): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}
