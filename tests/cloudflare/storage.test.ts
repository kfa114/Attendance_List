import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  initialize,
  SqlRepository,
  SqlRuntime,
} from "../../server/cloudflare/storage";
import { Service } from "../../server/service";
function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...params: any[]) {
      let rows: any[] = [];
      if (/^\s*SELECT/i.test(query)) rows = db.prepare(query).all(...params);
      else if (params.length) db.prepare(query).run(...params);
      else db.exec(query);
      return { toArray: () => rows };
    },
  } as any;
  initialize(sql);
  const storage = {
    sql,
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const repo = new SqlRepository(storage);
  const rt = new SqlRuntime(
    sql,
    "https://attendance.example",
    true,
    "client-a",
  );
  const service = new Service(repo, rt);
  const call = (action: string, data: any = {}, token = "") =>
    service.handle({ action, data, token });
  const admin = call("login", {}).data.token;
  return { db, sql, storage, repo, rt, service, call, admin };
}
test("SQLite 저장·정렬·프로그램 범위·트랜잭션 롤백", () => {
  const f = fixture();
  f.repo.put("participants", { id: "p1", programId: "a", name: "가상" });
  f.repo.put("participants", { id: "p2", programId: "b", name: "다른 명단" });
  assert.equal(f.repo.list("participants", "a").length, 1);
  assert.throws(() =>
    f.repo.lock(() => {
      f.repo.put("participants", { id: "rollback", programId: "a" });
      f.rt.putImage("data:image/png;base64,example", "fake.png");
      throw new Error("rollback");
    }),
  );
  assert.equal(f.repo.list("participants", "a").length, 1);
  assert.equal(f.sql.exec("SELECT * FROM files").toArray().length, 0);
  f.repo.lock(() =>
    f.repo.putMany("participants", [
      { id: "p3", programId: "a" },
      { id: "p4", programId: "a" },
    ]),
  );
  assert.deepEqual(
    f.repo.list<any>("participants", "a").map((p) => p.id),
    ["p1", "p3", "p4"],
  );
});
test("인스턴스를 다시 만들어도 관리자 세션 유지, 로그아웃·만료 차단", () => {
  const f = fixture();
  const rt = new SqlRuntime(f.sql, "https://attendance.example");
  assert.equal(rt.session(f.admin)?.kind, "admin");
  rt.saveSession({
    token: "expired",
    kind: "admin",
    expiresAt: 1,
    by: "관리자",
  });
  assert.equal(rt.session("expired"), null);
  rt.deleteSession(f.admin);
  assert.equal(f.rt.session(f.admin), null);
});
test("잘못된 로그인 제한은 발신자별로 분리하고 재시작 뒤에도 유지", () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.rt.throttle("admin");
  assert.throws(() =>
    new SqlRuntime(
      f.sql,
      "https://attendance.example",
      false,
      "client-a",
    ).throttle("admin"),
  );
  new SqlRuntime(
    f.sql,
    "https://attendance.example",
    false,
    "client-b",
  ).throttle("admin");
  f.rt.clearThrottle("admin");
  f.rt.throttle("admin");
});
test("Cloudflare 저장소에서 명단 생성·충돌·휴지통·복원 전체 흐름", () => {
  const f = fixture();
  const p = f.call(
    "createProgram",
    {
      title: "가상 명단",
      signatureEnabled: false,
      dates: ["2026-10-20"],
      participants: [{ name: "가상 교육생", phone: "01000001001", note: "" }],
    },
    f.admin,
  ).data;
  assert.ok(p.id);
  const updated = f.call(
    "setProgramStatus",
    { programId: p.id, revision: p.revision, status: "deleted" },
    f.admin,
  ).data;
  assert.equal(
    f.call("getBundle", { programId: p.id }, f.admin).code,
    "NOT_FOUND",
  );
  assert.equal(
    f.call(
      "setProgramStatus",
      { programId: p.id, revision: p.revision, status: "active" },
      f.admin,
    ).code,
    "CONFLICT",
  );
  assert.equal(
    f.call(
      "setProgramStatus",
      { programId: p.id, revision: updated.revision, status: "active" },
      f.admin,
    ).ok,
    true,
  );
  assert.equal(
    f.call("getBundle", { programId: p.id }, f.admin).data.participants.length,
    1,
  );
});
test("서명 파일을 포함한 출력 스냅샷은 이후 상태와 독립적으로 유지", () => {
  const f = fixture();
  const image = "data:image/png;base64,example";
  const id = f.rt.putImage(image, "test.png");
  const file = f.rt.createPdf("한글 출석부", "2026-10-20", [
    {
      order: 1,
      name: "교육생",
      singleMode: true,
      single: id,
      singleStatus: "서명 완료",
      am: "",
      pm: "",
      amStatus: "",
      pmStatus: "",
    },
  ]);
  const downloaded = f.rt.pdf(file.fileId);
  assert.equal(downloaded.format, "attendance-snapshot");
  assert.equal(downloaded.snapshot.rows[0].single, image);
  assert.equal(downloaded.snapshot.title, "한글 출석부");
  f.rt.removeFile(id);
  assert.throws(() => f.rt.pdf(file.fileId));
});
