import type {
  Checkpoint,
  CheckpointKind,
  Freeze,
  PageContext,
  RestoreReport,
} from "./types";

/** popup -> background */
export interface FreezeWindowMsg { type: "CF_FREEZE_WINDOW"; windowId: number }
export interface ListFreezesMsg { type: "CF_LIST_FREEZES" }
export interface RestoreFreezeMsg { type: "CF_RESTORE_FREEZE"; id: string }
export interface DeleteFreezeMsg { type: "CF_DELETE_FREEZE"; id: string }
export interface RenameFreezeMsg { type: "CF_RENAME_FREEZE"; id: string; name: string }

/** content -> background */
export interface ContentReadyMsg { type: "CF_CONTENT_READY"; url: string }
export interface RestoreReportMsg { type: "CF_RESTORE_REPORT"; report: RestoreReport }

/** popup -> background */
export interface LastReportsMsg { type: "CF_LAST_REPORTS" }

/** popup -> background, checkpoints */
export interface AddCheckpointMsg { type: "CF_ADD_CHECKPOINT"; tabId: number; kind: CheckpointKind }
export interface ListCheckpointsMsg { type: "CF_LIST_CHECKPOINTS"; url: string }
export interface JumpCheckpointMsg { type: "CF_JUMP_CHECKPOINT"; tabId: number; id: string }
export interface DeleteCheckpointMsg { type: "CF_DELETE_CHECKPOINT"; id: string }
export interface RenameCheckpointMsg { type: "CF_RENAME_CHECKPOINT"; id: string; label: string }
export interface AllCheckpointsMsg { type: "CF_ALL_CHECKPOINTS" }
export interface ImportCheckpointsMsg { type: "CF_IMPORT_CHECKPOINTS"; text: string }

/** content -> background */
export interface AutosaveMsg { type: "CF_AUTOSAVE"; draft: CheckpointDraft }

/** background -> content */
export interface DropMsg { type: "CF_DROP"; kind: CheckpointKind }
export interface JumpMsg { type: "CF_JUMP"; checkpoint: Checkpoint }
export interface NamePromptMsg {
  type: "CF_NAME_PROMPT";
  target: "checkpoint" | "freeze";
  id: string;
  defaultLabel: string;
  title: string;
}

export type CheckpointDraft = Omit<Checkpoint, "id" | "key">;

/** background -> content */
export interface CaptureMsg { type: "CF_CAPTURE" }
export interface RestoreMsg { type: "CF_RESTORE"; context: PageContext }

export type Message =
  | FreezeWindowMsg
  | ListFreezesMsg
  | RestoreFreezeMsg
  | DeleteFreezeMsg
  | RenameFreezeMsg
  | ContentReadyMsg
  | RestoreReportMsg
  | LastReportsMsg
  | CaptureMsg
  | RestoreMsg
  | AddCheckpointMsg
  | ListCheckpointsMsg
  | JumpCheckpointMsg
  | DeleteCheckpointMsg
  | RenameCheckpointMsg
  | AllCheckpointsMsg
  | ImportCheckpointsMsg
  | AutosaveMsg
  | DropMsg
  | JumpMsg
  | NamePromptMsg;

export type CaptureResponse =
  | { ok: true; context: PageContext }
  | { ok: false; error: string };

export type ContentReadyResponse = { context?: PageContext };

export type FreezeResponse =
  | { ok: true; freeze: Freeze; skipped: number }
  | { ok: false; error: string };

export type ListResponse = { freezes: Freeze[] };

export type RestoreResponse =
  | { ok: true; opened: number; skipped: number }
  | { ok: false; error: string };

export type LastReportsResponse = { reports: RestoreReport[] };

export type DropResponse = { ok: true; draft: CheckpointDraft } | { ok: false; error: string };
export type CheckpointListResponse = { checkpoints: Checkpoint[] };
export type ImportResponse =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: string };
export type SimpleResponse = { ok: true } | { ok: false; error: string };
/** addCheckpoint hands the new id back so the popup can offer to rename it. */
export type AddCheckpointResponse =
  | { ok: true; id: string; label: string }
  | { ok: false; error: string };
