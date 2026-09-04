import type {
  AddCheckpointResponse,
  CheckpointListResponse,
  FreezeResponse,
  LastReportsResponse,
  ListResponse,
  DiagnoseResponse,
  ImportResponse,
  RestoreResponse,
  SimpleResponse,
} from "../messages";
import { toBundle, toMarkdown } from "../export";
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

const copyButton = document.getElementById("copy") as HTMLButtonElement;
const saveMdButton = document.getElementById("save-md") as HTMLButtonElement;
const saveJsonButton = document.getElementById("save-json") as HTMLButtonElement;
const importButton = document.getElementById("import") as HTMLButtonElement;
const importInput = document.getElementById("import-file") as HTMLInputElement;
const diagnoseButton = document.getElementById("diagnose") as HTMLButtonElement;
const reportPanel = document.getElementById("report-panel") as HTMLElement;
const reportEl = document.getElementById("report") as HTMLPreElement;
const reportCopy = document.getElementById("report-copy") as HTMLButtonElement;
const reportClose = document.getElementById("report-close") as HTMLButtonElement;
const recoverButton = document.getElementById("recover") as HTMLButtonElement;

/** The tab the popup was opened over. Every checkpoint action is relative to it. */
let currentTab: chrome.tabs.Tab | null = null;

/* ------------------------------------------------------------ export/import */

async function everyCheckpoint(): Promise<Checkpoint[]> {
  const { checkpoints }: CheckpointListResponse =
    await chrome.runtime.sendMessage({ type: "CF_ALL_CHECKPOINTS" });
  return checkpoints;
}

function fileStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * chrome.downloads rather than a synthetic <a download> click: some Chrome
 * builds tear the popup down mid-click, and a download that silently does not
 * happen is the worst possible outcome for a "keep this forever" feature.
 */
async function download(text: string, filename: string, type: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } finally {
    // Give the download a moment to take hold of the blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

copyButton.addEventListener("click", async () => {
  const checkpoints = await everyCheckpoint();
  if (!checkpoints.length) return setStatus("Nothing to copy yet.");
  await navigator.clipboard.writeText(toMarkdown(checkpoints));
  setStatus(`Copied ${checkpoints.length} checkpoints. Paste anywhere.`);
});

saveMdButton.addEventListener("click", async () => {
  const checkpoints = await everyCheckpoint();
  if (!checkpoints.length) return setStatus("Nothing to export yet.");
  await download(toMarkdown(checkpoints), `contextfreeze-${fileStamp()}.md`, "text/markdown");
});

saveJsonButton.addEventListener("click", async () => {
  const checkpoints = await everyCheckpoint();
  if (!checkpoints.length) return setStatus("Nothing to export yet.");
  await download(
    JSON.stringify(toBundle(checkpoints), null, 2),
    `contextfreeze-${fileStamp()}.json`,
    "application/json",
  );
});

importButton.addEventListener("click", () => importInput.click());

/* ----------------------------------------------------------------- diagnose */

diagnoseButton.addEventListener("click", async () => {
  if (currentTab?.id == null) return;
  diagnoseButton.disabled = true;
  setStatus("Looking at the page...");

  let result: DiagnoseResponse;
  try {
    result = await chrome.tabs.sendMessage(currentTab.id, { type: "CF_DIAGNOSE" });
  } catch {
    result = { ok: false, error: "No content script on this page. Reload it and try again." };
  }
  diagnoseButton.disabled = false;

  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  setStatus("");
  reportEl.textContent = result.report;
  reportEl.classList.remove("wrap");
  reportPanel.hidden = false;
  reportEl.focus();
});

reportCopy.addEventListener("click", async () => {
  await navigator.clipboard.writeText(reportEl.textContent ?? "");
  setStatus("Diagnostic copied. Paste it anywhere.");
});

reportClose.addEventListener("click", () => {
  reportPanel.hidden = true;
  reportEl.textContent = "";
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  importInput.value = "";

  const result: ImportResponse = await chrome.runtime.sendMessage({
    type: "CF_IMPORT_CHECKPOINTS",
    text: await file.text(),
  });

  if (!result.ok) return setStatus(result.error);
  setStatus(
    result.added
      ? `Imported ${result.added}${result.skipped ? `, ${result.skipped} already here` : ""}.`
      : "Everything in that file was already here.",
  );
  await refreshCheckpoints();
});

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
    setStatus(""); // the prompt to type a name has been answered
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
  const highlights = freeze.tabs.filter((t) => t.context?.selection).length;

  const bits = [tabs + (tabs === 1 ? " tab" : " tabs")];
  if (withContext < tabs) bits.push(withContext + " with context");
  if (scrolls) bits.push(scrolls + " scroll");
  if (fields) bits.push(fields + (fields === 1 ? " field" : " fields"));
  if (media) bits.push(media + " media");
  if (highlights) bits.push(highlights + (highlights === 1 ? " highlight" : " highlights"));
  return bits.join(" · ");
}

function renderRow(freeze: Freeze, editing: boolean): HTMLLIElement {
  const fragment = rowTemplate.content.cloneNode(true) as DocumentFragment;
  const row = fragment.querySelector(".row") as HTMLLIElement;
  const nameButton = row.querySelector(".name") as HTMLButtonElement;
  const meta = row.querySelector(".meta") as HTMLParagraphElement;
  const restoreButton = row.querySelector(".restore") as HTMLButtonElement;
  const deleteButton = row.querySelector(".delete") as HTMLButtonElement;

  nameButton.textContent = freeze.name;
  nameButton.title = freeze.name;
  meta.textContent = describeFreeze(freeze);

  const rename = () =>
    beginEdit(nameButton, freeze.name, async (name) => {
      await chrome.runtime.sendMessage({ type: "CF_RENAME_FREEZE", id: freeze.id, name });
      await refresh();
    });

  nameButton.addEventListener("click", rename);
  if (editing) queueMicrotask(rename);

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

/** contenteditable values are HTML; show the words, not the markup. */
function asPlainText(value: string, kind: string): string {
  if (kind !== "contenteditable") return value;
  const holder = document.createElement("div");
  holder.innerHTML = value;
  return holder.innerText.trim();
}

function recoverySheet(report: RestoreReport): string {
  const lines = [
    "Text ContextFreeze could not put back",
    report.url,
    "",
  ];
  for (const field of report.unrestored) {
    lines.push(`--- ${field.label} (${field.kind}) ---`);
    lines.push(asPlainText(field.value, field.kind));
    lines.push("");
  }
  return lines.join("\n");
}

async function showLastReport(): Promise<void> {
  const { reports }: LastReportsResponse =
    await chrome.runtime.sendMessage({ type: "CF_LAST_REPORTS" });
  const latest = reports[0];
  if (!latest) return;

  const line = summariseReport(latest);
  if (line) setStatus(line);

  // If text was captured and could not be put back, it is still here. Offer it
  // instead of quietly losing someone's half-written comment.
  if (latest.unrestored?.length) {
    recoverButton.hidden = false;
    recoverButton.textContent =
      `Recover ${latest.unrestored.length} unrestored field` +
      (latest.unrestored.length === 1 ? "" : "s");
    recoverButton.onclick = () => {
      reportEl.textContent = recoverySheet(latest);
      reportEl.classList.add("wrap");
      reportPanel.hidden = false;
      reportEl.focus();
    };
  }
}

function describeCheckpoint(checkpoint: Checkpoint): string {
  if (checkpoint.kind === "media") {
    const at = checkpoint.media ? formatClock(checkpoint.media.currentTime) : null;
    const total = checkpoint.media?.duration;
    // Once you name a flag, the label no longer says when it is - so the meta
    // line has to. Unnamed flags are already labelled with the time, and
    // repeating it there would just be noise.
    const named = at !== null && checkpoint.label !== at;
    if (named && at) return total ? `${at} · of ${formatClock(total)}` : at;
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

async function refresh(editId?: string): Promise<void> {
  const { freezes }: ListResponse = await chrome.runtime.sendMessage({ type: "CF_LIST_FREEZES" });
  listEl.replaceChildren(...freezes.map((f) => renderRow(f, f.id === editId)));
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

  freezeButton.disabled = false;

  if (!result.ok) {
    setStatus(result.error);
    await refresh();
    return;
  }

  setStatus(
    result.skipped
      ? `Frozen. ${result.skipped} tab${result.skipped === 1 ? "" : "s"} could not be read - ` +
        "reload and freeze again to include them."
      : "Frozen. Type a name, or press Escape to keep the timestamp.",
  );
  // Straight into naming it. A list of timestamps is not something you can
  // search through a week later.
  await refresh(result.freeze.id);
});

void (async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = activeTab ?? null;
  await refreshCheckpoints();
  await refresh();
  await showLastReport();
})();
