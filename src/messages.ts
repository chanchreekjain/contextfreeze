import type { Freeze, PageContext, RestoreReport } from "./types";

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
  | RestoreMsg;

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
