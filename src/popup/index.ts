import type {
  FreezeResponse,
  LastReportsResponse,
  ListResponse,
  RestoreResponse,
} from "../messages";
import type { Freeze, RestoreReport } from "../types";

const freezeButton = document.getElementById("freeze") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const listEl = document.getElementById("list") as HTMLUListElement;
const emptyEl = document.getElementById("empty") as HTMLParagraphElement;
const rowTemplate = document.getElementById("row-template") as HTMLTemplateElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function describeFreeze(freeze: Freeze): string {
  const tabs = freeze.tabs.length;
  const withContext = freeze.tabs.filter((t) => t.context !== null).length;
  const scrolls = freeze.tabs.reduce((n, t) => n + (t.context?.scrolls.length ?? 0), 0);
  const fields = freeze.tabs.reduce((n, t) => n + (t.context?.fields.length ?? 0), 0);
  const media = freeze.tabs.reduce((n, t) => n + (t.context?.media.length ?? 0), 0);

  const bits = [tabs + (tabs === 1 ? " tab" : " tabs")];
  if (withContext < tabs) bits.push(withContext + " with context");
  if (scrolls) bits.push(scrolls + " scroll");
  if (fields) bits.push(fields + (fields === 1 ? " field" : " fields"));
  if (media) bits.push(media + " media");
  return bits.join(" · ");
}

function renderRow(freeze: Freeze): HTMLLIElement {
  const fragment = rowTemplate.content.cloneNode(true) as DocumentFragment;
  const row = fragment.querySelector(".row") as HTMLLIElement;
  const nameButton = row.querySelector(".name") as HTMLButtonElement;
  const meta = row.querySelector(".meta") as HTMLParagraphElement;
  const restoreButton = row.querySelector(".restore") as HTMLButtonElement;
  const deleteButton = row.querySelector(".delete") as HTMLButtonElement;

  nameButton.textContent = freeze.name;
  nameButton.title = freeze.name;
  meta.textContent = describeFreeze(freeze);

  nameButton.addEventListener("click", async () => {
    const next = window.prompt("Rename this freeze", freeze.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === freeze.name) return;
    await chrome.runtime.sendMessage({ type: "CF_RENAME_FREEZE", id: freeze.id, name: trimmed });
    await refresh();
  });

  restoreButton.addEventListener("click", async () => {
    restoreButton.disabled = true;
    setStatus("Reopening...");
    const result: RestoreResponse = await chrome.runtime.sendMessage({
      type: "CF_RESTORE_FREEZE",
      id: freeze.id,
    });
    if (!result.ok) {
      setStatus(result.error);
      restoreButton.disabled = false;
      return;
    }
    setStatus(
      "Opened " + result.opened + " tabs" + (result.skipped ? ", " + result.skipped + " skipped" : ""),
    );
    window.close();
  });

  deleteButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CF_DELETE_FREEZE", id: freeze.id });
    await refresh();
  });

  return row;
}

/**
 * A restore that quietly half-worked is worse than one that failed loudly, so
 * say what actually came back the last time.
 */
function summariseReport(report: RestoreReport): string {
  const parts: Array<[string, [number, number]]> = [
    ["scroll", report.scrolls],
    ["fields", report.fields],
    ["media", report.media],
    ["highlight", report.selection],
  ];
  const restored = parts.reduce((n, [, [got]]) => n + got, 0);
  const total = parts.reduce((n, [, [, all]]) => n + all, 0);
  if (!total) return "";

  const missed = parts.filter(([, [got, all]]) => all > 0 && got < all).map(([name]) => name);
  const host = (() => {
    try { return new URL(report.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();

  if (!missed.length) return `Last restore: everything came back on ${host}.`;
  if (report.aborted) return `Last restore on ${host}: ${restored}/${total} - you took over.`;
  return `Last restore on ${host}: ${restored}/${total}, missed ${missed.join(", ")}.`;
}

async function showLastReport(): Promise<void> {
  const { reports }: LastReportsResponse =
    await chrome.runtime.sendMessage({ type: "CF_LAST_REPORTS" });
  const latest = reports[0];
  if (latest) {
    const line = summariseReport(latest);
    if (line) setStatus(line);
  }
}

async function refresh(): Promise<void> {
  const { freezes }: ListResponse = await chrome.runtime.sendMessage({ type: "CF_LIST_FREEZES" });
  listEl.replaceChildren(...freezes.map(renderRow));
  emptyEl.hidden = freezes.length > 0;
}

freezeButton.addEventListener("click", async () => {
  freezeButton.disabled = true;
  setStatus("Reading every tab...");

  const win = await chrome.windows.getCurrent();
  if (win.id == null) {
    setStatus("Could not identify this window.");
    freezeButton.disabled = false;
    return;
  }

  const result: FreezeResponse = await chrome.runtime.sendMessage({
    type: "CF_FREEZE_WINDOW",
    windowId: win.id,
  });

  if (!result.ok) {
    setStatus(result.error);
  } else if (result.skipped) {
    setStatus(
      "Frozen. " + result.skipped + " tab" + (result.skipped === 1 ? "" : "s") +
        " could not be read - reload and freeze again to include them.",
    );
  } else {
    setStatus("Frozen.");
  }

  freezeButton.disabled = false;
  await refresh();
});

void refresh();
void showLastReport();
