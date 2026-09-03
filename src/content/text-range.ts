/**
 * Re-finding a highlight after a reload.
 *
 * The captured selection text is whitespace-normalised, but the live DOM is
 * not, and a selection routinely spans several text nodes ("the **end of one
 * <em>tag</em> and the start** of another"). So we walk the text nodes once,
 * building a normalised string alongside a per-character map back to
 * (node, offset). Then a plain indexOf on the normalised string gives us
 * everything we need to rebuild the Range.
 */

const MAX_SCAN_CHARS = 200_000;
const SKIP_TAGS = /^(script|style|noscript|template)$/i;

interface CharMap {
  text: string;
  nodes: Text[];
  offsets: number[];
}

function buildCharMap(root: Node): CharMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let lastWasSpace = true; // leading whitespace is trimmed, same as capture

  let current = walker.nextNode();
  while (current && chars.length < MAX_SCAN_CHARS) {
    const node = current as Text;
    const parent = node.parentElement;
    if (parent && !SKIP_TAGS.test(parent.tagName)) {
      const data = node.data;
      for (let i = 0; i < data.length; i++) {
        const ch = data.charAt(i);
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue;
          chars.push(" ");
          nodes.push(node);
          offsets.push(i);
          lastWasSpace = true;
        } else {
          chars.push(ch);
          nodes.push(node);
          offsets.push(i);
          lastWasSpace = false;
        }
      }
    }
    current = walker.nextNode();
  }

  return { text: chars.join(""), nodes, offsets };
}

/** Returns a live Range matching `needle`, or null if the text is gone. */
export function findTextRange(root: Node, needle: string): Range | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const map = buildCharMap(root);
  const at = map.text.indexOf(trimmed);
  if (at === -1) return null;

  const endIndex = at + trimmed.length - 1;
  const startNode = map.nodes[at];
  const endNode = map.nodes[endIndex];
  const startOffset = map.offsets[at];
  const endOffset = map.offsets[endIndex];
  if (!startNode || !endNode || startOffset === undefined || endOffset === undefined) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    return range;
  } catch {
    return null;
  }
}
