import { timestampedUrl } from "./site-adapters";
import type { Checkpoint } from "./types";

/**
 * Checkpoints live in extension storage, which is only as durable as a Chrome
 * profile. Anything worth keeping for years needs to be able to leave.
 *
 * Two shapes, because they answer different questions:
 *   markdown - readable in Notepad five years from now with no software at all,
 *              and its video flags are ordinary clickable links
 *   json     - lossless and re-importable
 */

export const EXPORT_FORMAT = "contextfreeze-checkpoints";
export const EXPORT_VERSION = 1;

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  checkpoints: Checkpoint[];
}

export function toBundle(checkpoints: Checkpoint[], now = new Date()): ExportBundle {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    checkpoints,
  };
}

function stamp(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function groupByPage(checkpoints: Checkpoint[]): Map<string, Checkpoint[]> {
  const groups = new Map<string, Checkpoint[]>();
  for (const checkpoint of checkpoints) {
    const existing = groups.get(checkpoint.key);
    if (existing) existing.push(checkpoint);
    else groups.set(checkpoint.key, [checkpoint]);
  }
  return groups;
}

export function toMarkdown(checkpoints: Checkpoint[], now = new Date()): string {
  const groups = groupByPage(checkpoints);
  const lines: string[] = [
    "# ContextFreeze checkpoints",
    "",
    `Exported ${stamp(now.getTime())}`,
    `${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} across ` +
      `${groups.size} page${groups.size === 1 ? "" : "s"}`,
    "",
  ];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;

    lines.push("", "## " + (first.title || first.url), first.url, "");

    for (const checkpoint of group) {
      if (checkpoint.kind === "media" && checkpoint.media) {
        const at = timestampedUrl(checkpoint.url, checkpoint.media.currentTime);
        lines.push(`- ${checkpoint.label}`);
        // A flag exported as a plain link is the whole point: it still works
        // when this extension is long gone.
        if (at) lines.push(`  ${at}`);
        lines.push(`  ${stamp(checkpoint.createdAt)}`);
      } else {
        lines.push(`- ${checkpoint.label}${checkpoint.auto ? "  (updates as you read)" : ""}`);
        const quote = checkpoint.scroll?.anchorText?.trim();
        if (quote && quote !== checkpoint.label) lines.push(`  "${quote}"`);
        lines.push(`  ${stamp(checkpoint.createdAt)}`);
      }
      lines.push("");
    }
  }

  // CRLF, because the stated destination is Notepad.
  return lines.join("\r\n").replace(/(\r\n){3,}/g, "\r\n\r\n") + "\r\n";
}

export type ImportResult =
  | { ok: true; checkpoints: Checkpoint[] }
  | { ok: false; error: string };

/** Deliberately strict: a half-understood file silently importing junk is worse than a refusal. */
export function parseBundle(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not a JSON file." };
  }

  const bundle = parsed as Partial<ExportBundle>;
  if (bundle?.format !== EXPORT_FORMAT) {
    return { ok: false, error: "That JSON is not a ContextFreeze export." };
  }
  if (!Array.isArray(bundle.checkpoints)) {
    return { ok: false, error: "That export has no checkpoints in it." };
  }

  const checkpoints = bundle.checkpoints.filter(
    (c): c is Checkpoint =>
      Boolean(c) &&
      typeof c.id === "string" &&
      typeof c.key === "string" &&
      typeof c.url === "string" &&
      typeof c.label === "string" &&
      (c.kind === "position" || c.kind === "media"),
  );

  if (!checkpoints.length) return { ok: false, error: "No usable checkpoints in that file." };
  return { ok: true, checkpoints };
}
