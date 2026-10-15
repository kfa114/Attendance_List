import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { Repository, Runtime } from "./ports";
import type { Session, Table } from "../src/domain/model";
import { AppError } from "../src/domain/rules";
export class LocalRepository implements Repository {
  constructor(private filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (!fs.existsSync(filename)) fs.writeFileSync(filename, "{}");
  }
  private read() {
    return JSON.parse(fs.readFileSync(this.filename, "utf8"));
  }
  list<T>(table: Table, programId?: string): T[] {
    return (this.read()[table] || []).filter(
      (r: any) => !programId || r.programId === programId,
    );
  }
  put(table: Table, record: any) {
    this.putMany(table, [record]);
  }
  putMany(table: Table, records: any[]) {
    const all = this.read();
    const rows = all[table] || [];
    records.forEach((record) => {
      const index = rows.findIndex((r: any) => r.id === record.id);
      if (index < 0) rows.push(record);
      else rows[index] = record;
    });
    all[table] = rows;
    fs.writeFileSync(`${this.filename}.tmp`, JSON.stringify(all));
    fs.renameSync(`${this.filename}.tmp`, this.filename);
  }
  remove(table: Table, id: string) {
    const all = this.read();
    all[table] = (all[table] || []).filter((r: any) => r.id !== id);
    fs.writeFileSync(this.filename, JSON.stringify(all));
  }
  lock<T>(fn: () => T): T {
    return fn();
  }
}
export class LocalRuntime implements Runtime {
  sessions = new Map<string, Session>();
  attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private directory: string,
    private secret = "local-preview-admin",
  ) {
    fs.mkdirSync(directory, { recursive: true });
  }
  now() {
    return new Date();
  }
  id() {
    return crypto.randomUUID();
  }
  session(token: string) {
    return this.sessions.get(token) || null;
  }
  saveSession(s: Session) {
    this.sessions.set(s.token, s);
  }
  deleteSession(token: string) {
    this.sessions.delete(token);
  }
  adminLogin(secret: string) {
    return secret === this.secret;
  }
  throttle(key: string) {
    let a = this.attempts.get(key);
    if (!a || a.until <= Date.now()) {
      a = { count: 0, until: Date.now() + 900000 };
      this.attempts.set(key, a);
    }
    if (a.count >= 5)
      throw new AppError(
        "조회 시도가 많습니다. 15분 후 다시 시도해주세요.",
        "RATE_LIMIT",
      );
    a.count++;
  }
  clearThrottle(key: string) {
    this.attempts.delete(key);
  }
  putImage(url: string) {
    const id = `${this.id()}.png`;
    fs.writeFileSync(
      path.join(this.directory, id),
      Buffer.from(url.split(",")[1], "base64"),
    );
    return id;
  }
  image(id: string) {
    return `data:image/png;base64,${fs.readFileSync(path.join(this.directory, path.basename(id))).toString("base64")}`;
  }
  removeFile(id: string) {
    fs.unlinkSync(path.join(this.directory, path.basename(id)));
  }
  createPdf(): { fileId: string } {
    throw new AppError(
      "PDF 생성은 Apps Script 배포 후 사용할 수 있습니다. 로컬에서는 화면 미리보기를 이용해주세요.",
      "LOCAL_ONLY",
    );
  }
  pdf(): { base64: string; name: string } {
    throw new AppError("Apps Script 배포 후 사용할 수 있습니다.", "LOCAL_ONLY");
  }
  importer() {
    return "";
  }
  appUrl() {
    return "";
  }
}
