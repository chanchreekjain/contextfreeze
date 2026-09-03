import type {
  AddCheckpointResponse,
  CheckpointListResponse,
  FreezeResponse,
  LastReportsResponse,
  ListResponse,
  RestoreResponse,
  SimpleResponse,
} from "../messages";
import type { Checkpoint, CheckpointKind, Freeze, RestoreReport } from "../types";

const freezeButton = document.getElementById("freeze") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const listEl = document.getElementById("list") as HTMLUListElement;
const emptyEl = document.getElementById("empty") as HTMLParagraphElement;
const rowTemplate = document.getElementById("row-template") as HTMLTemplateElement;
const hereSection = document.getElementById("here") as HTMLElement;
const markSpotButton = document.getElementById("mark-spot") as HTMLButtonElement;
const markMomentButton = document.getElementById("mark-moment") as HTMLButtonElement;
const checkpointList = document.getElementById("checkpoints") as HTMLUListElement;
const noCheckpoints = document.getElementById("no-checkpoints") as HTMLParagraphElement;
const checkpointTemplate = document.getElementById("checkpoint-template") as HTMLTemplateElement;

/** The tab the popup was opened over. Every checkpoint action is relative to it. */
let currentTab: chrome.tabs.Tab | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/**
 * Rename in place rather than through window.prompt(). A prompt inside an
 * extension popup is a coin toss - some Chrome builds dismiss the popup along
 * with the dialog, taking the thing you were renaming with it.
 */
function beginEdit(
  nameButton: HTMLButtonElement,
  current: string,
  commit: (label: string) => Promise<void>,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "name-input";
  input.value = current;
  input.spellcheck = false;

  let settled = false;
  const finish = async (label: string | null) => {
    if (settled) return;
    settled = true;
    input.replaceWith(nameButton);
    const trimmed = label?.trim();
    if (trimmed && trimmed !== current) await commit(trimmed);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void finish(null);
    }
  });
  input.addEventListener("blur", () => void finish(input.value));

  nameButton.replaceWith(input);
  input.focus();
  input.select();
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

  nameButton.addEventListener("click", () =>
    beginEdit(nameButton, freeze.name, async (name) => {
      await chrome.runtime.sendMessage({ type: "CF_RENAME_FREEZE", id: freeze.id, name });
      await refresh();
    }),
  );

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

function describeCheckpoint(checkpoint: Checkpoint): string {
  if (checkpoint.kind === "media") {
    const total = checkpoint.media?.duration;
    return total ? `video · of ${formatClock(total)}` : "video";
  }
  const when = new Date(checkpoint.createdAt).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
  return checkpoint.auto ? `updates as you read · ${when}` : when;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

function renderCheckpoint(checkpoint: Checkpoint, editing: boolean): HTMLLIElement {
  const fragment = checkpointTemplate.content.cloneNode(true) as DocumentFragment;
  const row = fragment.querySelector(".checkpoint") as HTMLLIElement;
  const badge = row.querySelector(".badge") as HTMLElement;
  const name = row.querySelector(".name") as HTMLButtonElement;
  const meta = row.querySelector(".meta") as HTMLParagraphElement;
  const jump = row.querySelector(".jump") as HTMLButtonElement;
  const remove = row.querySelector(".delete") as HTMLButtonElement;

  if (checkpoint.auto) row.classList.add("is-auto");
  badge.textContent = checkpoint.kind === "media" ? "▶" : checkpoint.auto ? "◆" : "◇";
  name.textContent = checkpoint.label;
  name.title = checkpoint.label;
  meta.textContent = describeCheckpoint(checkpoint);

  const rename = () =>
    beginEdit(name, checkpoint.label, async (label) => {
      await chrome.runtime.sendMessage({
        type: "CF_RENAME_CHECKPOINT", id: checkpoint.id, label,
      });
      await refreshCheckpoints();
    });

  name.addEventListener("click", rename);
  if (editing) queueMicrotask(rename);

  jump.addEventListener("click", async () => {
    if (currentTab?.id == null) return;
    jump.disabled = true;
    const result: SimpleResponse = await chrome.runtime.sendMessage({
      type: "CF_JUMP_CHECKPOINT", tabId: currentTab.id, id: checkpoint.id,
    });
    if (!result.ok) {
      setStatus(result.error);
      jump.disabled = false;
      return;
    }
    window.close();
  });

  remove.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CF_DELETE_CHECKPOINT", id: checkpoint.id });
    await refreshCheckpoints();
  });

  return row;
}

async function refreshCheckpoints(editId?: string): Promise<void> {
  if (!currentTab?.url || !/^https?:/.test(currentTab.url)) {
    hereSection.hidden = true;
    return;
  }
  hereSection.hidden = false;

  const { checkpoints }: CheckpointListResponse = await chrome.runtime.sendMessage({
    type: "CF_LIST_CHECKPOINTS", url: currentTab.url,
  });
  checkpointList.replaceChildren(
    ...checkpoints.map((c) => renderCheckpoint(c, c.id === editId)),
  );
  noCheckpoints.hidden = checkpoints.length > 0;
}

async function mark(kind: CheckpointKind, button: HTMLButtonElement): Promise<void> {
  if (currentTab?.id == null) return;
  button.disabled = true;
  const result: AddCheckpointResponse = await chrome.runtime.sendMessage({
    type: "CF_ADD_CHECKPOINT", tabId: currentTab.id, kind,
  });
  button.disabled = false;

  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  // Drop straight into renaming it, with the default already selected - type a
  // name or press Escape and keep it.
  setStatus("Saved. Type a name, or press Escape to keep it.");
  await refreshCheckpoints(result.id);
}

markSpotButton.addEventListener("click", () => void mark("position", markSpotButton));
markMomentButton.addEventListener("click", () => void mark("media", markMomentButton));

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

void (async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = activeTab ?? null;
  await refreshCheckpoints();
  await refresh();
  await showLastReport();
})();
