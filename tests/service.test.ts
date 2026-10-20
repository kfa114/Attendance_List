import test from "node:test";
import assert from "node:assert/strict";
import { Service } from "../server/service";
import type { Repository, Runtime } from "../server/ports";
import type { ApiResponse, Session, Table } from "../src/domain/model";
class Repo implements Repository {
  data: Record<string, any[]> = {};
  list<T>(t: Table, p?: string): T[] {
    return (this.data[t] || []).filter((r) => !p || r.programId === p);
  }
  put(t: Table, r: any) {
    const a = (this.data[t] ||= []);
    const i = a.findIndex((x) => x.id === r.id);
    if (i < 0) a.push(r);
    else a[i] = r;
  }
  putMany(t: Table, rows: any[]) {
    rows.forEach((r) => this.put(t, r));
  }
  remove(t: Table, id: string) {
    this.data[t] = (this.data[t] || []).filter((r) => r.id !== id);
  }
  lock<T>(fn: () => T) {
    return fn();
  }
}
class RT implements Runtime {
  at = "2026-10-15T03:59:59Z";
  counter = 0;
  sessions = new Map<string, Session>();
  files: string[] = [];
  pdfRows: any[] = [];
  now() {
    return new Date(this.at);
  }
  id() {
    return `id-${++this.counter}`;
  }
  session(t: string) {
    return this.sessions.get(t) || null;
  }
  saveSession(s: Session) {
    this.sessions.set(s.token, s);
  }
  deleteSession(t: string) {
    this.sessions.delete(t);
  }
  adminLogin(s: string) {
    return s === "test-secret";
  }
  throttle() {}
  clearThrottle() {}
  putImage() {
    const id = this.id();
    this.files.push(id);
    return id;
  }
  image() {
    return "";
  }
  removeFile(id: string) {
    this.files = this.files.filter((f) => f !== id);
  }
  createPdf(_title: string, _date: string, rows: any[]) {
    this.pdfRows = rows;
    return { fileId: this.id() };
  }
  pdf() {
    return { name: "a.pdf", base64: "" };
  }
  importer() {
    return "";
  }
  appUrl() {
    return "";
  }
}
function fixture() {
  const db = new Repo(),
    rt = new RT(),
    service = new Service(db, rt);
  const call = (action: string, data: any = {}, token = "") =>
    service.handle({ action, data, token });
  const admin = ok(call("login", { secret: "test-secret" })).token;
  const create = (title = "첫 프로그램", signatureEnabled = true) =>
    ok(
      call(
        "createProgram",
        {
          title,
          signatureEnabled,
          dates: ["2026-10-15", "2026-10-16"],
          participants: [
            { name: "참여자", phone: "01000001001", note: "비공개" },
            { name: "동명이인", phone: "01099991001", note: "" },
            { name: "단독", phone: "01000002001", note: "" },
          ],
        },
        admin,
      ),
    );
  const p = create();
  return { db, rt, call, admin, p, create };
}
function ok(r: ApiResponse) {
  assert.equal(r.ok, true, r.error);
  return r.data;
}
const image = "data:image/png;base64,iVBORw0KGgo" + "A".repeat(200);
test("관리자 인증 없이 명단 열람·생성 불가", () => {
  const f = fixture();
  assert.equal(f.call("bootstrap").code, "AUTH");
  assert.equal(f.call("createProgram", {}).code, "AUTH");
  assert.equal(f.call("login", { secret: "bad" }).ok, false);
});
test("중복 번호 이름 단계, 이름까지 중복이면 차단", () => {
  const f = fixture();
  assert.deepEqual(
    ok(f.call("studentLogin", { programId: f.p.id, last4: "1001" })),
    {
      needsName: true,
      candidates: f.db
        .list<any>("participants", f.p.id)
        .slice(0, 2)
        .map(({ id, name, order }) => ({ id, name, order })),
    },
  );
  assert.equal(
    ok(
      f.call("studentLogin", {
        programId: f.p.id,
        last4: "1001",
        name: "참여자",
      }),
    ).kind,
    "student",
  );
  const rows = f.db.list<any>("participants", f.p.id);
  rows[1].name = "참여자";
  assert.equal(
    f.call("studentLogin", { programId: f.p.id, last4: "1001", name: "참여자" })
      .ok,
    false,
  );
});
test("교육생은 본인 정보만 조회하며 다른 프로그램 접근 차단", () => {
  const f = fixture();
  const s = ok(f.call("studentLogin", { programId: f.p.id, last4: "2001" }));
  const b = ok(f.call("getBundle", { programId: f.p.id }, s.token));
  assert.equal(b.participants.length, 1);
  assert.equal(b.participants[0].phone, "");
  assert.equal(b.participants[0].note, "");
  const p2 = f.create("다른 프로그램");
  assert.equal(
    f.call("getBundle", { programId: p2.id }, s.token).code,
    "FORBIDDEN",
  );
  assert.equal(f.call("decide", { programId: f.p.id }, s.token).code, "AUTH");
});
test("태블릿은 연락처·비고·신고·판단·서명 경로를 받지 않음", () => {
  const f = fixture();
  const t = ok(f.call("tabletSession", { programId: f.p.id }, f.admin));
  const b = ok(f.call("getBundle", { programId: f.p.id }, t.token));
  assert.equal(b.participants.length, 3);
  assert.ok(b.participants.every((p: any) => p.phone === "" && p.note === ""));
  assert.deepEqual(b.absences, []);
  assert.deepEqual(b.decisions, []);
  assert.equal(f.call("bootstrap", {}, t.token).code, "AUTH");
});
test("13시 이전 서명 저장, 재시도는 동일 결과, 중복 요청은 차단", () => {
  const f = fixture();
  const r = f.db.list<any>("participants", f.p.id)[0];
  const d = {
    programId: f.p.id,
    participantId: r.id,
    date: "2026-10-15",
    period: "am",
    image,
    requestId: "once",
  };
  assert.equal(f.call("sign", d, f.admin).ok, true);
  assert.equal(f.call("sign", d, f.admin).ok, true);
  assert.equal(f.db.list("signatures", f.p.id).length, 1);
  assert.equal(
    f.call("sign", { ...d, requestId: "twice" }, f.admin).code,
    "DUPLICATE",
  );
});
test("13시·18시 마감은 서버에서 차단하고 강사 판단은 마감 후 허용", () => {
  const f = fixture();
  const r = f.db.list<any>("participants", f.p.id)[0];
  const d = {
    programId: f.p.id,
    participantId: r.id,
    date: "2026-10-15",
    period: "am",
    image,
    requestId: "close",
  };
  f.rt.at = "2026-10-15T04:00:00Z";
  assert.equal(f.call("sign", d, f.admin).code, "CLOSED");
  f.rt.at = "2026-10-15T09:00:00Z";
  const fresh = ok(f.call("login", { secret: "test-secret" })).token;
  assert.equal(f.call("sign", { ...d, period: "pm" }, fresh).code, "CLOSED");
  assert.equal(f.call("decide", { ...d, result: "present" }, fresh).ok, true);
  assert.equal(f.db.list("signatures").length, 0);
  assert.equal(f.db.list("decisions").length, 1);
});
test("오전·오후 해제 후 기본 서명·신고 가능, 교육일과 기존 기록 보존", () => {
  const f = fixture();
  const t = ok(f.call("tabletSession", { programId: f.p.id }, f.admin));
  const s = ok(f.call("studentLogin", { programId: f.p.id, last4: "2001" }));
  const rows = f.db.list<any>("participants", f.p.id);
  const original = f.p;
  ok(
    f.call(
      "sign",
      {
        programId: f.p.id,
        participantId: rows[0].id,
        date: "2026-10-15",
        period: "am",
        image,
        requestId: "before-switch",
      },
      t.token,
    ),
  );
  const updated = ok(
    f.call(
      "updateProgram",
      {
        ...original,
        programId: original.id,
        signatureEnabled: false,
        participants: rows,
        participantIds: rows.map((r) => r.id),
      },
      f.admin,
    ),
  );
  assert.equal(updated.signatureEnabled, false);
  assert.equal(f.call("getBundle", { programId: f.p.id }, t.token).ok, true);
  assert.deepEqual(updated.dates, original.dates);
  assert.equal(f.db.list<any>("signatures", f.p.id)[0].period, "am");
  assert.equal(
    f.call(
      "report",
      { programId: f.p.id, date: "2026-10-15", period: "am", absent: true },
      s.token,
    ).ok,
    false,
  );
  ok(
    f.call(
      "report",
      { programId: f.p.id, date: "2026-10-15", period: "single", absent: true },
      s.token,
    ),
  );
  const sign = {
    programId: f.p.id,
    participantId: rows[0].id,
    date: "2026-10-15",
    period: "single",
    image,
    requestId: "single",
  };
  ok(f.call("sign", sign, t.token));
  assert.equal(
    f.call("sign", { ...sign, requestId: "again" }, t.token).code,
    "DUPLICATE",
  );
  assert.equal(f.call("sign", { ...sign, period: "pm" }, t.token).ok, false);
  ok(
    f.call("createExport", { programId: f.p.id, date: "2026-10-15" }, f.admin),
  );
  assert.equal(f.rt.pdfRows[0].singleMode, true);
  assert.ok(f.rt.pdfRows[0].single);
  assert.equal(f.rt.pdfRows[0].singleStatus, "서명 완료");
  assert.equal(f.db.list("signatures", f.p.id).length, 2);
  assert.equal(f.db.list("participants", f.p.id).length, 3);
});
test("신고는 오전·오후별로 독립, 마감 이후 수정 불가", () => {
  const f = fixture();
  const s = ok(f.call("studentLogin", { programId: f.p.id, last4: "2001" }));
  const d = {
    programId: f.p.id,
    date: "2026-10-15",
    period: "am",
    absent: true,
  };
  ok(f.call("report", d, s.token));
  ok(f.call("report", { ...d, period: "pm" }, s.token));
  ok(f.call("report", { ...d, absent: false }, s.token));
  assert.equal(
    f.db.list<any>("absences", f.p.id).find((a) => a.period === "pm").absent,
    true,
  );
  f.rt.at = "2026-10-15T04:00:00Z";
  assert.equal(f.call("report", d, s.token).code, "CLOSED");
});
test("편집 충돌·프로그램 간 참여자 연결·제거 차단", () => {
  const f = fixture();
  const p2 = f.create("둘");
  const rows = f.db.list<any>("participants", f.p.id);
  const data = {
    ...f.p,
    programId: f.p.id,
    participants: rows,
    participantIds: rows.map((r) => r.id),
  };
  assert.equal(
    f.call("updateProgram", { ...data, revision: 0 }, f.admin).code,
    "CONFLICT",
  );
  assert.equal(
    f.call(
      "updateProgram",
      {
        ...data,
        participantIds: f.db.list<any>("participants", p2.id).map((r) => r.id),
      },
      f.admin,
    ).ok,
    false,
  );
  assert.equal(
    f.call(
      "updateProgram",
      {
        ...data,
        participants: rows.slice(1),
        participantIds: rows.slice(1).map((r) => r.id),
      },
      f.admin,
    ).ok,
    false,
  );
});
test("저장 중 마감되면 파일 정리·서명 미완료", () => {
  const f = fixture();
  const r = f.db.list<any>("participants", f.p.id)[0];
  const put = f.rt.putImage.bind(f.rt);
  f.rt.putImage = () => {
    const id = put();
    f.rt.at = "2026-10-15T04:00:00Z";
    return id;
  };
  assert.equal(
    f.call(
      "sign",
      {
        programId: f.p.id,
        participantId: r.id,
        date: "2026-10-15",
        period: "am",
        image,
        requestId: "late",
      },
      f.admin,
    ).code,
    "CLOSED",
  );
  assert.equal(f.rt.files.length, 0);
  assert.equal(f.db.list("signatures").length, 0);
});
test("활성 설정과 기간에 관계없이 미래·미등록 교육일·잘못된 이미지 차단", () => {
  const f = fixture();
  const r = f.db.list<any>("participants", f.p.id)[0];
  const d = {
    programId: f.p.id,
    participantId: r.id,
    date: "2026-10-16",
    period: "am",
    image,
    requestId: "n",
  };
  assert.equal(f.call("sign", d, f.admin).code, "CLOSED");
  assert.equal(f.call("sign", { ...d, date: "2026-10-17" }, f.admin).ok, false);
  assert.equal(
    f.call("sign", { ...d, date: "2026-10-15", image: "bad" }, f.admin).ok,
    false,
  );
});

test("기본 서명 프로그램도 생성 즉시 로그인·태블릿 사용, 18시 이후 저장 차단", () => {
  const f = fixture();
  const p = f.create("기본 서명", false);
  const t = ok(f.call("tabletSession", { programId: p.id }, f.admin));
  ok(f.call("studentLogin", { programId: p.id, last4: "2001" }));
  f.rt.at = "2026-10-15T09:00:00Z";
  const participantId = f.db.list<any>("participants", p.id)[0].id;
  assert.equal(
    f.call(
      "sign",
      {
        programId: p.id,
        participantId,
        date: "2026-10-15",
        period: "single",
        image,
        requestId: "late",
      },
      t.token,
    ).code,
    "CLOSED",
  );
});

test("목록 상태 변경은 관리자만 가능하고 충돌·잘못된 상태를 차단", () => {
  const f = fixture();
  const t = ok(f.call("tabletSession", { programId: f.p.id }, f.admin));
  const d = { programId: f.p.id, revision: f.p.revision, status: "archived" };
  assert.equal(f.call("setProgramStatus", d).code, "AUTH");
  assert.equal(f.call("setProgramStatus", d, t.token).code, "AUTH");
  assert.equal(
    f.call("setProgramStatus", { ...d, status: "unknown" }, f.admin).ok,
    false,
  );
  ok(f.call("setProgramStatus", d, f.admin));
  assert.equal(
    f.call("setProgramStatus", { ...d, status: "deleted" }, f.admin).code,
    "CONFLICT",
  );
});
test("보관·휴지통·복원은 관련 기록 보존, 삭제 후 기존 링크 접근 차단", () => {
  const f = fixture();
  const t = ok(f.call("tabletSession", { programId: f.p.id }, f.admin));
  const participantId = f.db.list<any>("participants", f.p.id)[0].id;
  ok(
    f.call(
      "sign",
      {
        programId: f.p.id,
        participantId,
        date: "2026-10-15",
        period: "am",
        image,
        requestId: "preserve",
      },
      t.token,
    ),
  );
  const original = ok(f.call("getBundle", { programId: f.p.id }, f.admin));
  let p = ok(
    f.call(
      "setProgramStatus",
      { programId: f.p.id, revision: f.p.revision, status: "archived" },
      f.admin,
    ),
  );
  assert.equal(
    ok(f.call("getBundle", { programId: p.id }, f.admin)).signatures.length,
    1,
  );
  assert.equal(f.call("getBundle", { programId: p.id }, t.token).ok, false);
  p = ok(
    f.call(
      "setProgramStatus",
      { programId: p.id, revision: p.revision, status: "deleted" },
      f.admin,
    ),
  );
  for (const action of [
    "publicProgram",
    "getBundle",
    "studentLogin",
    "tabletSession",
    "createExport",
    "downloadExport",
  ])
    assert.equal(
      f.call(
        action,
        { programId: p.id },
        action === "publicProgram" || action === "studentLogin" ? "" : f.admin,
      ).code,
      "NOT_FOUND",
    );
  assert.equal(
    f.call("getBundle", { programId: p.id }, t.token).code,
    "NOT_FOUND",
  );
  assert.equal(
    ok(f.call("bootstrap", {}, f.admin)).programs.find(
      (r: any) => r.id === p.id,
    ).status,
    "deleted",
  );
  p = ok(
    f.call(
      "setProgramStatus",
      { programId: p.id, revision: p.revision, status: "active" },
      f.admin,
    ),
  );
  const restored = ok(f.call("getBundle", { programId: p.id }, f.admin));
  assert.deepEqual(restored.participants, original.participants);
  assert.deepEqual(restored.signatures, original.signatures);
  assert.deepEqual(restored.program.dates, original.program.dates);
  assert.equal(f.rt.files.length, 1);
});

test("중복 뒷자리 후보는 이름·순번만 제공하고 선택은 해당 번호 안에서 검증", () => {
  const f = fixture();
  const result = ok(
    f.call("studentLogin", { programId: f.p.id, last4: "1001" }),
  );
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
    "id",
    "name",
    "order",
  ]);
  const selected = result.candidates[1];
  const s = ok(
    f.call("studentLogin", {
      programId: f.p.id,
      last4: "1001",
      participantId: selected.id,
    }),
  );
  assert.equal(s.participantId, selected.id);
  const outsider = f.db.list<any>("participants", f.p.id)[2];
  assert.equal(
    f.call("studentLogin", {
      programId: f.p.id,
      last4: "1001",
      participantId: outsider.id,
    }).code,
    "LOGIN",
  );
  const rows = f.db.list<any>("participants", f.p.id);
  rows[1].name = rows[0].name;
  assert.equal(
    ok(
      f.call("studentLogin", {
        programId: f.p.id,
        last4: "1001",
        participantId: rows[1].id,
      }),
    ).participantId,
    rows[1].id,
  );
});

test("휴대폰 QR은 선택한 프로그램·교육일·시간의 이름 목록과 서명만 허용", () => {
  const f = fixture();
  const tablet = ok(f.call("tabletSession", { programId: f.p.id }, f.admin));
  const slot = { programId: f.p.id, date: "2026-10-15", period: "am" };
  const qr = ok(f.call("signingSession", slot, tablet.token));
  assert.match(qr.url, /role=signing&token=/);
  assert.notEqual(qr.token, tablet.token);
  const roster = ok(f.call("signingRoster", { programId: f.p.id }, qr.token));
  assert.equal(roster.open, true);
  assert.deepEqual(Object.keys(roster.participants[0]).sort(), [
    "id",
    "name",
    "order",
    "signed",
  ]);
  assert.equal(
    f.call("getBundle", { programId: f.p.id }, qr.token).code,
    "FORBIDDEN",
  );
  assert.equal(f.call("bootstrap", {}, qr.token).code, "AUTH");
  assert.equal(
    f.call("tabletSession", { programId: f.p.id }, qr.token).code,
    "AUTH",
  );
  assert.equal(f.call("signingSession", slot, qr.token).code, "FORBIDDEN");
  const student = ok(
    f.call("studentLogin", { programId: f.p.id, last4: "2001" }),
  );
  assert.equal(f.call("signingSession", slot, student.token).code, "FORBIDDEN");
  const sign = {
    ...slot,
    participantId: roster.participants[0].id,
    image,
    requestId: "mobile-once",
  };
  assert.equal(
    f.call("sign", { ...sign, period: "pm" }, qr.token).code,
    "FORBIDDEN",
  );
  assert.equal(
    f.call("sign", { ...sign, date: "2026-10-16" }, qr.token).code,
    "FORBIDDEN",
  );
  const other = f.create("별도 프로그램");
  assert.equal(
    f.call("signingRoster", { programId: other.id }, qr.token).code,
    "FORBIDDEN",
  );
  assert.equal(
    f.call("sign", { ...sign, programId: other.id }, qr.token).code,
    "FORBIDDEN",
  );
  assert.equal(f.call("sign", sign, qr.token).ok, true);
  assert.equal(f.call("sign", sign, qr.token).ok, true);
  assert.equal(
    f.call("sign", { ...sign, requestId: "another-device" }, qr.token).code,
    "DUPLICATE",
  );
  assert.equal(
    ok(f.call("signingRoster", { programId: f.p.id }, qr.token)).participants[0]
      .signed,
    true,
  );
  f.rt.at = "2026-10-15T04:00:00Z";
  assert.equal(
    ok(f.call("signingRoster", { programId: f.p.id }, qr.token)).open,
    false,
  );
  assert.equal(
    f.call(
      "sign",
      { ...sign, participantId: roster.participants[1].id },
      qr.token,
    ).code,
    "CLOSED",
  );
  assert.equal(f.call("signingSession", slot, tablet.token).code, "CLOSED");
});

test("단일 서명 QR, 만료, 보관·휴지통 및 서명 방식 변경 차단", () => {
  const f = fixture();
  const p = f.create("단일", false);
  const slot = { programId: p.id, date: "2026-10-15", period: "single" };
  const qr = ok(f.call("signingSession", slot, f.admin));
  const roster = ok(f.call("signingRoster", { programId: p.id }, qr.token));
  assert.equal(roster.period, "single");
  assert.equal(
    f.call(
      "sign",
      {
        ...slot,
        participantId: roster.participants[0].id,
        image,
        requestId: "single-mobile",
      },
      qr.token,
    ).ok,
    true,
  );
  assert.equal(
    f.call("signingSession", { ...slot, period: "am" }, f.admin).ok,
    false,
  );
  const record = f.db.list<any>("programs").find((r) => r.id === p.id);
  record.signatureEnabled = true;
  assert.equal(
    f.call("signingRoster", { programId: p.id }, qr.token).ok,
    false,
  );
  record.signatureEnabled = false;
  record.status = "archived";
  assert.equal(
    f.call("signingRoster", { programId: p.id }, qr.token).ok,
    false,
  );
  record.status = "deleted";
  assert.equal(
    f.call("signingRoster", { programId: p.id }, qr.token).code,
    "NOT_FOUND",
  );
  record.status = "active";
  f.rt.at = new Date(qr.expiresAt).toISOString();
  assert.equal(
    f.call("signingRoster", { programId: p.id }, qr.token).code,
    "AUTH",
  );
});
