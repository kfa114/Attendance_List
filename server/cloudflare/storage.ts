import type {
  DurableObjectStorage,
  SqlStorage,
} from "@cloudflare/workers-types";
import type { Repository, Runtime } from "../ports";
import type { Session, Table } from "../../src/domain/model";
import type { AttendanceSnapshot, PdfRow } from "../../src/domain/export";
import { AppError } from "../../src/domain/rules";

export function initialize(sql: SqlStorage) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, program_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (kind,id));
    CREATE INDEX IF NOT EXISTS records_by_program ON records(kind,program_id);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_by_expiry ON attempts(expires);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL);
  `);
}
export class SqlRepository implements Repository {
  private inTransaction = false;
  constructor(
    private storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  ) {}
  list<T>(kind: Table, programId?: string): T[] {
    const rows = programId
      ? this.storage.sql.exec(
          "SELECT payload FROM records WHERE kind=? AND program_id=? ORDER BY rowid",
          kind,
          programId,
        )
      : this.storage.sql.exec(
          "SELECT payload FROM records WHERE kind=? ORDER BY rowid",
          kind,
        );
    return rows.toArray().map((r) => JSON.parse(String(r.payload)) as T);
  }
  put(kind: Table, record: any) {
    this.storage.sql.exec(
      "INSERT INTO records(kind,id,program_id,payload) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET program_id=excluded.program_id,payload=excluded.payload",
      kind,
      record.id,
      record.programId || "",
      JSON.stringify(record),
    );
  }
  putMany(kind: Table, records: any[]) {
    this.lock(() => records.forEach((record) => this.put(kind, record)));
  }
  remove(kind: Table, id: string) {
    this.storage.sql.exec(
      "DELETE FROM records WHERE kind=? AND id=?",
      kind,
      id,
    );
  }
  lock<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    return this.storage.transactionSync(() => {
      this.inTransaction = true;
      try {
        return fn();
      } finally {
        this.inTransaction = false;
      }
    });
  }
}
export class SqlRuntime implements Runtime {
  constructor(
    private sql: SqlStorage,
    private origin: string,
    private acceptedLogin = false,
    private loginScope = "anonymous",
  ) {}
  now() {
    return new Date();
  }
  id() {
    return crypto.randomUUID();
  }
  session(token: string): Session | null {
    const r = this.sql
      .exec(
        "SELECT payload FROM sessions WHERE token=? AND expires>?",
        token,
        Date.now(),
      )
      .toArray()[0];
    return r ? JSON.parse(String(r.payload)) : null;
  }
  saveSession(s: Session) {
    this.sql.exec(
      "INSERT INTO sessions(token,expires,payload) VALUES(?,?,?)",
      s.token,
      s.expiresAt,
      JSON.stringify(s),
    );
  }
  deleteSession(token: string) {
    this.sql.exec("DELETE FROM sessions WHERE token=?", token);
  }
  adminLogin() {
    return this.acceptedLogin;
  }
  throttle(key: string) {
    // Restrict attempts per source instead of allowing one caller to lock out all administrators.
    const scoped = `${this.loginScope}:${key}`;
    const r = this.sql
      .exec("SELECT count,expires FROM attempts WHERE key=?", scoped)
      .toArray()[0];
    const count = r && Number(r.expires) > Date.now() ? Number(r.count) : 0;
    const expires = count ? Number(r.expires) : Date.now() + 900_000;
    if (count >= 5)
      throw new AppError(
        "조회 시도가 많습니다. 15분 후 다시 시도해주세요.",
        "RATE_LIMIT",
      );
    this.sql.exec(
      "INSERT INTO attempts(key,count,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=excluded.expires",
      scoped,
      count + 1,
      expires,
    );
  }
  clearThrottle(key: string) {
    this.sql.exec(
      "DELETE FROM attempts WHERE key=?",
      `${this.loginScope}:${key}`,
    );
  }
  putImage(dataUrl: string, name: string) {
    const id = this.id();
    this.sql.exec(
      "INSERT INTO files(id,kind,name,payload) VALUES(?,?,?,?)",
      id,
      "image",
      name,
      dataUrl,
    );
    return id;
  }
  image(id: string) {
    const r = this.sql
      .exec("SELECT payload FROM files WHERE id=? AND kind='image'", id)
      .toArray()[0];
    if (!r) throw new AppError("서명 파일을 찾을 수 없습니다.");
    return String(r.payload);
  }
  removeFile(id: string) {
    this.sql.exec("DELETE FROM files WHERE id=?", id);
  }
  createPdf(title: string, date: string, rows: PdfRow[]) {
    const id = this.id();
    const snapshot: AttendanceSnapshot = { title, date, rows };
    this.sql.exec(
      "INSERT INTO files(id,kind,name,payload) VALUES(?,?,?,?)",
      id,
      "attendance",
      `${date}_출석부.pdf`,
      JSON.stringify(snapshot),
    );
    return { fileId: id };
  }
  pdf(id: string) {
    const r = this.sql
      .exec(
        "SELECT name,payload FROM files WHERE id=? AND kind='attendance'",
        id,
      )
      .toArray()[0];
    if (!r) throw new AppError("출석부 버전을 찾을 수 없습니다.");
    const snapshot = JSON.parse(String(r.payload)) as AttendanceSnapshot;
    let imageBytes = 0;
    snapshot.rows = snapshot.rows.map((row) => {
      const resolve = (id?: string) => {
        const url = id ? this.image(id) : "";
        imageBytes += url.length;
        if (imageBytes > 12_000_000)
          throw new AppError(
            "출석부의 서명 이미지 용량이 큽니다. 관리자에게 문의해주세요.",
          );
        return url;
      };
      return {
        ...row,
        am: row.singleMode ? "" : resolve(row.am),
        pm: row.singleMode ? "" : resolve(row.pm),
        single: row.singleMode ? resolve(row.single) : "",
      };
    });
    return {
      format: "attendance-snapshot" as const,
      snapshot,
      name: String(r.name),
    };
  }
  importer() {
    return "";
  }
  platform() {
    return "cloudflare" as const;
  }
  appUrl() {
    return this.origin;
  }
}
