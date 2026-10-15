import { Service } from "./service";
import { AppError } from "../src/domain/rules";
import type { ApiRequest, Session, Table } from "../src/domain/model";
import type { Repository, Runtime } from "./ports";
const TABLES: Table[] = [
  "programs",
  "participants",
  "signatures",
  "absences",
  "decisions",
  "contacts",
  "audits",
  "exports",
];
function props() {
  return PropertiesService.getScriptProperties();
}
function workbook() {
  const id = props().getProperty("SPREADSHEET_ID");
  if (!id)
    throw new AppError(
      "아직 저장소가 연결되지 않았습니다. 관리자가 setup을 실행해주세요.",
      "SETUP",
    );
  return SpreadsheetApp.openById(id);
}
class SheetsRepository implements Repository {
  private cache = new Map<Table, any[]>();
  private sheet(table: Table) {
    const s = workbook().getSheetByName(table);
    if (!s) throw new AppError("저장소 구조를 확인해주세요.", "SETUP");
    return s;
  }
  list<T>(table: Table, programId?: string): T[] {
    if (!this.cache.has(table)) {
      const s = this.sheet(table);
      const values =
        s.getLastRow() > 1
          ? s.getRange(2, 1, s.getLastRow() - 1, 3).getDisplayValues()
          : [];
      this.cache.set(
        table,
        values.filter((r) => r[0]).map((r) => JSON.parse(r[2])),
      );
    }
    return this.cache
      .get(table)!
      .filter((r) => !programId || r.programId === programId) as T[];
  }
  put(table: Table, record: any) {
    this.putMany(table, [record]);
  }
  putMany(table: Table, records: any[]) {
    const rows = [...this.list<any>(table)];
    const indices = new Map(rows.map((r, i) => [r.id, i]));
    records.forEach((record) => {
      const i = indices.get(record.id);
      if (i === undefined) {
        indices.set(record.id, rows.length);
        rows.push(record);
      } else rows[i] = record;
    });
    const values = rows.map((r) => {
      const json = JSON.stringify(r);
      if (json.length > 45000)
        throw new AppError("한 항목의 저장 용량을 초과했습니다.");
      return [r.id, r.programId || "", json];
    });
    if (values.length)
      this.sheet(table)
        .getRange(2, 1, values.length, 3)
        .setNumberFormat("@")
        .setValues(values);
    this.cache.set(table, rows);
  }
  remove(table: Table, id: string) {
    const rows = this.list<any>(table);
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) this.sheet(table).deleteRow(index + 2);
    this.cache.delete(table);
  }
  lock<T>(fn: () => T): T {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000))
      throw new AppError(
        "다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.",
        "BUSY",
      );
    this.cache.clear();
    try {
      return fn();
    } finally {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }
}
function hash(value: string) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8,
    ),
  );
}
function cached(key: string) {
  const raw = CacheService.getScriptCache().get(hash(key));
  return raw ? JSON.parse(raw) : null;
}
function cache(key: string, data: unknown, seconds: number) {
  CacheService.getScriptCache().put(
    hash(key),
    JSON.stringify(data),
    Math.min(seconds, 21600),
  );
}
function constantEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
class GasRuntime implements Runtime {
  now() {
    return new Date();
  }
  id() {
    return Utilities.getUuid();
  }
  session(token: string) {
    return cached(`session:${token}`) as Session | null;
  }
  saveSession(s: Session) {
    cache(
      `session:${s.token}`,
      s,
      Math.ceil((s.expiresAt - Date.now()) / 1000),
    );
  }
  deleteSession(token: string) {
    CacheService.getScriptCache().remove(hash(`session:${token}`));
  }
  adminLogin(secret: string) {
    const expected = props().getProperty("ADMIN_SECRET_HASH");
    if (!expected)
      throw new AppError(
        "관리자 암호가 설정되지 않았습니다. setup을 실행해주세요.",
        "SETUP",
      );
    return constantEqual(hash(secret), expected);
  }
  throttle(key: string) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw new AppError("잠시 후 다시 시도해주세요.");
    try {
      const item = cached(`attempt:${key}`) || { count: 0 };
      if (item.count >= 5)
        throw new AppError(
          "조회 시도가 많습니다. 15분 후 다시 시도해주세요.",
          "RATE_LIMIT",
        );
      cache(`attempt:${key}`, { count: item.count + 1 }, 900);
    } finally {
      lock.releaseLock();
    }
  }
  clearThrottle(key: string) {
    CacheService.getScriptCache().remove(hash(`attempt:${key}`));
  }
  private folder() {
    const id = props().getProperty("DRIVE_FOLDER_ID");
    if (!id) throw new AppError("서명 저장 폴더가 없습니다.", "SETUP");
    return DriveApp.getFolderById(id);
  }
  putImage(url: string, name: string) {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(url.split(",")[1]),
      "image/png",
      name,
    );
    return this.folder().createFile(blob).getId();
  }
  image(id: string) {
    const file = DriveApp.getFileById(id);
    return `data:image/png;base64,${Utilities.base64Encode(file.getBlob().getBytes())}`;
  }
  removeFile(id: string) {
    DriveApp.getFileById(id).setTrashed(true);
  }
  createPdf(
    title: string,
    date: string,
    rows: {
      order: number;
      name: string;
      singleMode?: boolean;
      single?: string;
      singleStatus?: string;
      am: string;
      pm: string;
      amStatus: string;
      pmStatus: string;
    }[],
  ) {
    const doc = DocumentApp.create(`${title}_${date}_출석부`);
    const temporaryId = doc.getId();
    try {
      const body = doc.getBody();
      body
        .appendParagraph(title)
        .setHeading(DocumentApp.ParagraphHeading.HEADING1);
      body.appendParagraph(
        `교육일 ${date} · 생성 ${Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm")}`,
      );
      const singleMode = rows[0]?.singleMode;
      const table = body.appendTable([
        singleMode
          ? ["순번", "이름", "서명"]
          : ["순번", "이름", "오전", "오후"],
      ]);
      rows.forEach((r) => {
        const row = table.appendTableRow();
        row.appendTableCell(String(r.order));
        row.appendTableCell(r.name);
        (singleMode
          ? [["single", r.single || "", r.singleStatus || ""]]
          : [
              ["am", r.am, r.amStatus],
              ["pm", r.pm, r.pmStatus],
            ]
        ).forEach(([, image, status]) => {
          const cell = row.appendTableCell(image ? "" : status);
          if (image) {
            const el = cell.appendImage(DriveApp.getFileById(image).getBlob());
            const ratio = el.getHeight() / el.getWidth();
            el.setWidth(110).setHeight(Math.min(65, Math.round(110 * ratio)));
          }
        });
      });
      doc.saveAndClose();
      const pdf = DriveApp.getFileById(temporaryId)
        .getAs("application/pdf")
        .setName(`${title}_${date}_${Date.now()}.pdf`);
      return { fileId: this.folder().createFile(pdf).getId() };
    } finally {
      DriveApp.getFileById(temporaryId).setTrashed(true);
    }
  }
  pdf(id: string) {
    const f = DriveApp.getFileById(id);
    return {
      base64: Utilities.base64Encode(f.getBlob().getBytes()),
      name: f.getName(),
    };
  }
  importer() {
    return HtmlService.createHtmlOutputFromFile("Importer").getContent();
  }
  appUrl() {
    return ScriptApp.getService().getUrl() || "";
  }
}
export function api(req: ApiRequest) {
  return new Service(new SheetsRepository(), new GasRuntime()).handle(req);
}
export function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("출석 — 프로그램 명단 관리")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1.0, viewport-fit=cover",
    );
}
export function setup() {
  const secret = props().getProperty("ADMIN_PASSPHRASE");
  if (!secret || secret.length < 16)
    throw new Error(
      "스크립트 속성 ADMIN_PASSPHRASE에 16자 이상의 관리자 암호를 먼저 입력해주세요.",
    );
  let id = props().getProperty("SPREADSHEET_ID");
  if (!id) {
    const file = SpreadsheetApp.create("출석_프로그램_운영데이터");
    id = file.getId();
    props().setProperty("SPREADSHEET_ID", id);
  }
  const ss = SpreadsheetApp.openById(id);
  TABLES.forEach((name) => {
    let s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.getRange(1, 1, 1, 3).setValues([["id", "programId", "payload"]]);
      s.setFrozenRows(1);
    }
  });
  if (!props().getProperty("DRIVE_FOLDER_ID"))
    props().setProperty(
      "DRIVE_FOLDER_ID",
      DriveApp.createFolder("출석_서명과출석부").getId(),
    );
  props().setProperty("ADMIN_SECRET_HASH", hash(secret));
  props().deleteProperty("ADMIN_PASSPHRASE");
  return {
    spreadsheetUrl: ss.getUrl(),
    message: "설정 완료. 암호 평문은 삭제했습니다. 웹앱을 배포해주세요.",
  };
}
