import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initialize, SqlRepository } from "../../server/cloudflare/storage";
import { purgeExpiredPrograms } from "../../server/cloudflare/trash";
import { TRASH_RETENTION_MS } from "../../src/domain/trash";
const now = Date.parse("2026-10-22T01:00:00Z");
function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...params: any[]) {
      const rows = /^\s*SELECT/i.test(query)
        ? db.prepare(query).all(...params)
        : (params.length ? db.prepare(query).run(...params) : db.exec(query),
          []);
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
  function program(id: string, status = "active", deletedAt?: string) {
    repo.put("programs", {
      id,
      title: id,
      status,
      signatureEnabled: false,
      dates: [],
      createdAt: new Date(now - 30 * 86400000).toISOString(),
      updatedAt: deletedAt || new Date(now).toISOString(),
      ...(deletedAt ? { deletedAt } : {}),
      revision: 1,
    });
  }
  function file(id: string, kind = "image") {
    sql.exec(
      "INSERT INTO files(id,kind,name,payload) VALUES(?,?,?,?)",
      id,
      kind,
      id,
      kind === "image" ? "private-png" : JSON.stringify({ rows: [] }),
    );
  }
  const count = (table: string) =>
    sql.exec(`SELECT * FROM ${table}`).toArray().length;
  return { db, sql, storage, repo, program, file, count };
}
test("7일 직전은 보존하고 경계에서 명단·취소 서명·재사용 이미지·PDF·세션을 원자적으로 영구 삭제", () => {
  const f = fixture();
  f.program(
    "expired",
    "deleted",
    new Date(now - TRASH_RETENTION_MS).toISOString(),
  );
  f.program("keep", "archived");
  f.file("source");
  f.file("canceled");
  f.file("snapshot", "attendance");
  f.file("other");
  f.repo.putMany("signatures", [
    { id: "s1", programId: "expired", fileId: "source" },
    {
      id: "s2",
      programId: "expired",
      fileId: "source",
      sourceSignatureId: "s1",
    },
    {
      id: "s3",
      programId: "expired",
      fileId: "canceled",
      canceledAt: "yesterday",
    },
    { id: "other", programId: "keep", fileId: "other" },
  ]);
  f.repo.put("exports", { id: "e1", programId: "expired", fileId: "snapshot" });
  for (const table of [
    "participants",
    "absences",
    "decisions",
    "contacts",
    "audits",
  ] as const)
    f.repo.put(table, { id: table, programId: "expired" });
  for (const [token, programId] of [
    ["tablet", "expired"],
    ["phone", "expired"],
    ["other", "keep"],
    ["admin", undefined],
  ])
    f.sql.exec(
      "INSERT INTO sessions(token,expires,payload) VALUES(?,?,?)",
      token,
      now + 100000,
      JSON.stringify({ token, programId }),
    );
  f.sql.exec(
    "INSERT INTO attempts(key,count,expires) VALUES(?,?,?)",
    "ip:student:expired:1234",
    1,
    now + 100000,
  );
  f.sql.exec(
    "INSERT INTO attempts(key,count,expires) VALUES(?,?,?)",
    "ip:student:keep:1234",
    1,
    now + 100000,
  );
  assert.equal(purgeExpiredPrograms(f.storage, now - 1), 0);
  assert.equal(f.count("files"), 4);
  assert.equal(purgeExpiredPrograms(f.storage, now), 1);
  assert.deepEqual(
    f.repo.list<any>("programs").map((p) => p.id),
    ["keep"],
  );
  assert.equal(
    f.sql.exec("SELECT * FROM records WHERE program_id=?", "expired").toArray()
      .length,
    0,
  );
  assert.deepEqual(
    f.sql
      .exec("SELECT id FROM files")
      .toArray()
      .map((f: any) => f.id),
    ["other"],
  );
  assert.equal(f.count("sessions"), 2);
  assert.equal(f.count("attempts"), 1);
  assert.equal(purgeExpiredPrograms(f.storage, now), 0);
});
test("기존 휴지통은 updatedAt으로 기한 계산, 날짜가 없으면 지금부터 보관, 다른 프로그램 파일 보호", () => {
  const f = fixture();
  f.program("legacy", "deleted");
  const p = f.repo.list<any>("programs")[0];
  p.updatedAt = new Date(now - TRASH_RETENTION_MS).toISOString();
  f.repo.put("programs", p);
  f.program("invalid", "deleted");
  const invalid = f.repo.list<any>("programs").find((p) => p.id === "invalid");
  invalid.updatedAt = "invalid";
  invalid.deletedAt = "invalid";
  f.repo.put("programs", invalid);
  f.program("active");
  f.file("shared");
  f.repo.putMany("signatures", [
    { id: "legacy-s", programId: "legacy", fileId: "shared" },
    { id: "active-s", programId: "active", fileId: "shared" },
  ]);
  assert.equal(purgeExpiredPrograms(f.storage, now), 1);
  assert.equal(f.count("files"), 1);
  assert.equal(
    f.repo.list<any>("programs").find((p) => p.id === "invalid").deletedAt,
    new Date(now).toISOString(),
  );
  assert.equal(
    purgeExpiredPrograms(f.storage, now + TRASH_RETENTION_MS - 1),
    0,
  );
  assert.equal(purgeExpiredPrograms(f.storage, now + TRASH_RETENTION_MS), 1);
  assert.equal(f.repo.list<any>("programs")[0].id, "active");
  assert.equal(f.count("files"), 1);
});
test("정리 중 실패하면 이미지와 명단을 롤백하고 재시도 가능", () => {
  const f = fixture();
  f.program(
    "expired",
    "deleted",
    new Date(now - TRASH_RETENTION_MS).toISOString(),
  );
  f.file("image");
  f.repo.put("signatures", { id: "s", programId: "expired", fileId: "image" });
  const exec = f.sql.exec;
  f.sql.exec = (query: string, ...params: any[]) => {
    if (query.startsWith("DELETE FROM sessions"))
      throw Error("injected failure");
    return exec(query, ...params);
  };
  assert.throws(() => purgeExpiredPrograms(f.storage, now));
  assert.equal(f.count("files"), 1);
  assert.equal(f.repo.list("programs").length, 1);
  f.sql.exec = exec;
  assert.equal(purgeExpiredPrograms(f.storage, now), 1);
  assert.equal(f.count("files"), 0);
});
