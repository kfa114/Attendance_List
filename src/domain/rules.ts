import {
  programPeriods,
  type Bundle,
  type DraftRow,
  type Period,
  type ProgramInput,
  type Program,
} from "./model";
export class AppError extends Error {
  constructor(
    message: string,
    public code = "VALIDATION",
  ) {
    super(message);
  }
}
export const LIMITS = {
  participants: 500,
  dates: 150,
  fileBytes: 5 * 1024 * 1024,
  signatureBytes: 750_000,
};
export function koreaDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function deadline(date: string, period: Period): number {
  return Date.parse(`${date}T${period === "am" ? "13" : "18"}:00:00+09:00`);
}
export function isClosed(
  date: string,
  period: Period,
  now = new Date(),
): boolean {
  return now.getTime() >= deadline(date, period);
}
export function canSign(
  date: string,
  period: Period,
  now = new Date(),
): boolean {
  return date === koreaDate(now) && !isClosed(date, period, now);
}
export function normalizePhone(value: string): string {
  return String(value)
    .trim()
    .replace(/[\s().-]/g, "")
    .replace(/^\+82/, "0");
}
export function validPhone(value: string): boolean {
  return /^0\d{8,10}$/.test(normalizePhone(value));
}
export function displayPhone(value: string): string {
  const p = normalizePhone(value);
  return p.length === 11
    ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`
    : p;
}
export function rowError(row: DraftRow): string {
  if (!row.name.trim()) return "이름을 입력해주세요.";
  if (row.name.length > 60) return "이름은 60자 이내로 입력해주세요.";
  if (!validPhone(row.phone)) return "연락처를 확인해주세요. 예: 010-1234-5678";
  if (row.note.length > 500) return "비고는 500자 이내로 입력해주세요.";
  return "";
}
export function validateProgram(input: ProgramInput): ProgramInput {
  if (
    !input ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 100
  )
    throw new AppError("프로그램명을 1~100자로 입력해주세요.");
  if (typeof input.signatureEnabled !== "boolean")
    throw new AppError("서명 사용 여부를 선택해주세요.");
  if (
    !Array.isArray(input.participants) ||
    !input.participants.length ||
    input.participants.length > LIMITS.participants
  )
    throw new AppError(
      `명단은 1~${LIMITS.participants}명까지 작성할 수 있습니다.`,
    );
  const participants = input.participants.map((r) => {
    if (
      !r ||
      typeof r.name !== "string" ||
      typeof r.phone !== "string" ||
      typeof r.note !== "string"
    )
      throw new AppError("명단 형식을 확인해주세요.");
    const error = rowError(r);
    if (error) throw new AppError(error);
    return {
      name: r.name.trim(),
      phone: normalizePhone(r.phone),
      note: r.note.trim(),
    };
  });
  if (
    !Array.isArray(input.dates) ||
    input.dates.length > LIMITS.dates ||
    input.dates.some((d) => typeof d !== "string" || !isDate(d))
  )
    throw new AppError("교육일을 확인해주세요.");
  return {
    title: input.title.trim(),
    signatureEnabled: input.signatureEnabled,
    dates: [...new Set(input.dates)].sort(),
    participants,
  };
}
export function assertPeriod(period: any): asserts period is Period {
  if (!["am", "pm", "single"].includes(period))
    throw new AppError("서명 구분을 확인해주세요.");
}
export function stateFor(
  bundle: Bundle,
  participantId: string,
  date: string,
  period: Period,
): string {
  if (
    bundle.signatures.some(
      (s) =>
        s.participantId === participantId &&
        s.date === date &&
        s.period === period,
    )
  )
    return "서명 완료";
  const decision = bundle.decisions.find(
    (d) =>
      d.participantId === participantId &&
      d.date === date &&
      d.period === period,
  );
  if (decision)
    return decision.result === "present" ? "강사 판단 출석" : "강사 판단 결석";
  if (date > koreaDate(new Date(bundle.serverNow))) return "진행 전";
  return "강사 판단 대기";
}
export function attendanceRate(bundle: Bundle, participantId: string) {
  const now = new Date(bundle.serverNow);
  const closed = bundle.program.dates.flatMap((date) =>
    programPeriods(bundle.program)
      .filter((p) => isClosed(date, p, now))
      .map((period) => ({ date, period })),
  );
  const signed = closed.filter((c) =>
    bundle.signatures.some(
      (s) =>
        s.participantId === participantId &&
        s.date === c.date &&
        s.period === c.period,
    ),
  ).length;
  return {
    signed,
    total: closed.length,
    rate: closed.length ? Math.round((signed / closed.length) * 100) : null,
  };
}
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
