export type Period = "am" | "pm" | "single";
export type Role = "student" | "tablet" | "admin" | "signing";
export interface Program {
  id: string;
  title: string;
  /** true: 오전·오후 구분, false: 교육일별 단일 서명 */
  signatureEnabled: boolean;
  status: "active" | "archived" | "deleted";
  dates: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** 이전 버전 저장 데이터 호환용. 현재 서명 방식에서는 집계에 사용하지 않음. */
  disabledIntervals?: { from: string; until?: string }[];
}
export interface Participant {
  id: string;
  programId: string;
  order: number;
  name: string;
  phone: string;
  note: string;
}
export interface Signature {
  id: string;
  programId: string;
  participantId: string;
  date: string;
  period: Period;
  fileId: string;
  signedAt: string;
  requestId: string;
}
export interface Absence {
  id: string;
  programId: string;
  participantId: string;
  date: string;
  period: Period;
  absent: boolean;
  updatedAt: string;
}
export interface Decision {
  id: string;
  programId: string;
  participantId: string;
  date: string;
  period: Period;
  result: "present" | "absent";
  by: string;
  updatedAt: string;
}
export interface Contact {
  id: string;
  programId: string;
  participantId: string;
  date: string;
  period: Period;
  assignee: string;
  result: string;
  updatedAt: string;
}
export interface Audit {
  id: string;
  programId: string;
  action: string;
  by: string;
  at: string;
}
export interface ExportRecord {
  id: string;
  programId: string;
  date: string;
  fileId: string;
  version: number;
  createdAt: string;
}
export interface Bundle {
  program: Program;
  participants: Participant[];
  signatures: Signature[];
  absences: Absence[];
  decisions: Decision[];
  contacts: Contact[];
  audits: Audit[];
  exports: ExportRecord[];
  serverNow: string;
}
export type ProgramSummary = Program & { participantCount: number };
export interface DraftRow {
  name: string;
  phone: string;
  note: string;
}
export interface ProgramInput {
  title: string;
  /** true: 오전·오후 구분, false: 교육일별 단일 서명 */
  signatureEnabled: boolean;
  dates: string[];
  participants: DraftRow[];
}
export interface Session {
  token: string;
  kind: "admin" | "student" | "tablet" | "signing";
  date?: string;
  period?: Period;
  programId?: string;
  participantId?: string;
  expiresAt: number;
  by: string;
}
export type Table =
  | "programs"
  | "participants"
  | "signatures"
  | "absences"
  | "decisions"
  | "contacts"
  | "audits"
  | "exports";
export interface ApiRequest {
  action: string;
  token?: string;
  data?: any;
}
export interface ApiResponse {
  ok: boolean;
  data?: any;
  error?: string;
  code?: string;
}
export const PERIODS: Period[] = ["am", "pm"];
export const PERIOD_LABEL: Record<Period, string> = {
  am: "오전",
  pm: "오후",
  single: "서명",
};
export function programPeriods(
  program: Pick<Program, "signatureEnabled">,
): Period[] {
  return program.signatureEnabled === false ? ["single"] : PERIODS;
}
