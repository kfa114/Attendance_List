import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceRate,
  canSign,
  isClosed,
  koreaDate,
  normalizePhone,
  validateProgram,
} from "../src/domain/rules";
import type { Bundle } from "../src/domain/model";
const bundle = {
  program: { dates: ["2026-10-14", "2026-10-15"] },
  signatures: [{ participantId: "p", date: "2026-10-14", period: "am" }],
  decisions: [
    { participantId: "p", date: "2026-10-14", period: "pm", result: "present" },
  ],
  serverNow: "2026-10-15T03:59:59Z",
} as Bundle;
test("한국 날짜와 오전 13시·오후 18시 경계", () => {
  assert.equal(koreaDate(new Date("2026-10-14T15:00:00Z")), "2026-10-15");
  assert.equal(
    canSign("2026-10-15", "am", new Date("2026-10-15T03:59:59Z")),
    true,
  );
  assert.equal(
    canSign("2026-10-15", "am", new Date("2026-10-15T04:00:00Z")),
    false,
  );
  assert.equal(
    canSign("2026-10-15", "pm", new Date("2026-10-15T08:59:59Z")),
    true,
  );
  assert.equal(
    canSign("2026-10-15", "pm", new Date("2026-10-15T09:00:00Z")),
    false,
  );
  assert.equal(
    canSign("2026-10-16", "am", new Date("2026-10-15T01:00:00Z")),
    false,
  );
  assert.equal(
    isClosed("2026-10-14", "pm", new Date("2026-10-15T01:00:00Z")),
    true,
  );
});
test("강사 판단은 출석률에 반영하지 않으며 마감 전은 분모·분자에서 제외", () => {
  assert.deepEqual(attendanceRate(bundle, "p"), {
    signed: 1,
    total: 2,
    rate: 50,
  });
  assert.deepEqual(
    attendanceRate({ ...bundle, serverNow: "2026-10-15T04:00:00Z" }, "p"),
    { signed: 1, total: 3, rate: 33 },
  );
  assert.deepEqual(
    attendanceRate(
      { ...bundle, program: { ...bundle.program, dates: ["2026-10-16"] } },
      "p",
    ),
    { signed: 0, total: 0, rate: null },
  );
});
test("파일·수동 입력 공통 검증: 앞자리 0 보존, 필수값, 교육일", () => {
  assert.equal(normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(normalizePhone("+82 10 1234 5678"), "01012345678");
  const valid = {
    title: " 명단 ",
    signatureEnabled: false,
    dates: [],
    participants: [{ name: " 가나다 ", phone: "010-1234-5678", note: "" }],
  };
  assert.equal(validateProgram(valid).participants[0].phone, "01012345678");
  assert.throws(() =>
    validateProgram({
      ...valid,
      participants: [{ name: "가나다", phone: "", note: "" }],
    }),
  );
  assert.throws(() => validateProgram({ ...valid, dates: ["2026-02-30"] }));
  assert.throws(() => validateProgram({ ...valid, participants: [] }));
});

test("오전·오후 해제 시 교육일당 단일 서명 집계와 18시 마감", () => {
  const b = {
    ...bundle,
    program: { ...bundle.program, signatureEnabled: false },
    signatures: [{ participantId: "p", date: "2026-10-14", period: "single" }],
  } as Bundle;
  assert.deepEqual(attendanceRate(b, "p"), { signed: 1, total: 1, rate: 100 });
  assert.deepEqual(
    attendanceRate({ ...b, serverNow: "2026-10-15T09:00:00Z" }, "p"),
    { signed: 1, total: 2, rate: 50 },
  );
  assert.equal(
    canSign("2026-10-15", "single", new Date("2026-10-15T08:59:59Z")),
    true,
  );
  assert.equal(
    canSign("2026-10-15", "single", new Date("2026-10-15T09:00:00Z")),
    false,
  );
});
