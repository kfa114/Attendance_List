import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { LIMITS } from "../domain/rules";
import type { DraftRow } from "../domain/model";
XLSX.set_cptable(cptable);
export type Grid = string[][];
export interface ImportedFile {
  name: string;
  sheets: { name: string; grid: Grid }[];
}
export interface ColumnMapping {
  name: number;
  phone: number;
  note: number;
}
const MAX_ROWS = 2000;
const MAX_COLUMNS = 100;

// CSV does not carry an Excel code-page record. Decode its bytes explicitly,
// and suppress spreadsheet-style numeric inference to preserve phone numbers.
function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
  }
}
function looksLikeWorkbook(bytes: Uint8Array, extension: string): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole =
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;
  if (extension === "xlsx") return zip || ole;
  if (extension === "ods") return zip;
  // Old .xls exporters can use BIFF, SpreadsheetML or an HTML table.
  const biff = bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]);
  const prefix = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart();
  return (
    ole ||
    biff ||
    /<(?:\w+:)?Workbook\b/i.test(prefix) ||
    /<(?:html|table)\b/i.test(prefix)
  );
}
export async function readFile(file: File): Promise<ImportedFile> {
  if (file.size > LIMITS.fileBytes)
    throw new Error("5MB 이하 파일을 선택해주세요.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!["xlsx", "xls", "csv", "ods"].includes(extension))
    throw new Error("엑셀(.xlsx, .xls), CSV, ODS 파일을 선택해주세요.");
  if (!file.size)
    throw new Error("파일이 비어 있습니다. 참여자가 담긴 파일을 선택해주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension !== "csv" && !looksLikeWorkbook(bytes, extension))
    throw new Error(
      "파일 내용이 엑셀·스프레드시트 형식과 맞지 않습니다. 원본에서 다시 내보내주세요.",
    );
  let book: XLSX.WorkBook;
  try {
    book =
      extension === "csv"
        ? XLSX.read(decodeCsv(bytes), {
            type: "string",
            raw: true,
            sheetRows: MAX_ROWS + 1,
          })
        : XLSX.read(bytes, {
            type: "array",
            cellDates: false,
            codepage: 949,
            sheetRows: MAX_ROWS + 1,
          });
  } catch {
    throw new Error(
      "파일을 읽을 수 없습니다. 손상 여부를 확인하고 암호를 해제한 뒤 다시 내보내주세요.",
    );
  }
  const sheets = book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const ref = sheet?.["!fullref"] || sheet?.["!ref"];
    if (!ref) return { name, grid: [] as Grid };
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r >= MAX_ROWS)
      throw new Error(
        "파일은 시트당 2,000행 이하로 정리해주세요. 명단은 최대 500명입니다.",
      );
    if (range.e.c >= MAX_COLUMNS)
      throw new Error("파일은 시트당 100열 이하로 정리해주세요.");
    // Start at A1 so the header selector refers to the actual spreadsheet row.
    const grid = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        range: { s: { r: 0, c: 0 }, e: range.e },
        raw: false,
        defval: "",
        blankrows: true,
      })
      .map((row) => Array.from(row, (value) => String(value ?? "").trim()));
    return { name, grid };
  });
  if (!sheets.some((s) => s.grid.some((row) => row.some((cell) => cell))))
    throw new Error(
      "파일 내용이 비어 있습니다. 참여자가 담긴 시트를 확인해주세요.",
    );
  return { name: file.name, sheets };
}
function headerKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[\s*＊]/g, "")
    .toLowerCase();
}
export function guessMapping(headers: string[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const find = (pattern: RegExp) => keys.findIndex((h) => pattern.test(h));
  const exactPhone = find(
    /^(연락처|전화번호|전화|휴대폰|휴대전화|휴대전화번호|휴대폰번호|핸드폰|핸드폰번호|phone|mobile|phonenumber)$/,
  );
  return {
    name: find(/^(이름|성명|name|참여자|참여자명|교육생명|학생명)$/),
    phone:
      exactPhone >= 0
        ? exactPhone
        : find(/^(참여자|교육생|학생|본인)(연락처|전화번호|휴대폰|휴대전화)$/),
    note: find(/^(비고|메모|note|notes|remark|remarks)$/),
  };
}
export function guessHeader(grid: Grid): number {
  let best = 0,
    score = 0;
  grid.forEach((row, i) => {
    const m = guessMapping(row);
    const current =
      (m.name >= 0 ? 2 : 0) + (m.phone >= 0 ? 2 : 0) + (m.note >= 0 ? 1 : 0);
    if (current > score) {
      best = i;
      score = current;
    }
  });
  return best;
}
// Only inspect rows above the column headers; participant names must never
// become a program title. Merged title cells are represented by one value.
export function guessTitle(grid: Grid, header = guessHeader(grid)): string {
  for (const row of grid.slice(0, header)) {
    const cells = row.map((cell) => cell.trim()).filter(Boolean);
    const labeled =
      cells.length === 2 &&
      /^(프로그램명|명단명|명단제목|교육명)[:：]?$/.test(
        cells[0].replace(/\s/g, ""),
      );
    if (cells.length !== 1 && !labeled) continue;
    const candidate = (labeled ? cells[1] : cells[0])
      .replace(/\s+/g, " ")
      .trim();
    if (candidate.length < 2 || candidate.length > 100) continue;
    if (/^[\d\s./:년월일()~-]+$/.test(candidate)) continue;
    if (/^(작성일|출력일|담당자|연락처|안내|주의|※|\*)/.test(candidate))
      continue;
    if (/^(프로그램명|명단명|명단제목|교육명)[:：]?$/.test(candidate)) continue;
    return candidate;
  }
  return "";
}
export function suggestSheet(file: ImportedFile): number {
  const matched = file.sheets.findIndex((s) => {
    const m = guessMapping(s.grid[guessHeader(s.grid)] || []);
    return m.name >= 0 && m.phone >= 0;
  });
  return matched >= 0
    ? matched
    : Math.max(
        0,
        file.sheets.findIndex((s) =>
          s.grid.some((row) => row.some((cell) => cell)),
        ),
      );
}
export function mapGrid(
  grid: Grid,
  header: number,
  mapping: ColumnMapping,
): DraftRow[] {
  if (!Number.isInteger(header) || header < 0 || header >= grid.length)
    throw new Error("제목 행을 확인해주세요.");
  const width = grid[header].length;
  const columns = [mapping.name, mapping.phone, mapping.note].filter(
    (i) => i >= 0,
  );
  if (
    mapping.name < 0 ||
    mapping.phone < 0 ||
    columns.some((i) => !Number.isInteger(i) || i >= width) ||
    new Set(columns).size !== columns.length
  )
    throw new Error("이름·연락처·비고를 서로 다른 유효한 열에 연결해주세요.");
  const rows = grid
    .slice(header + 1)
    .map((r) => ({
      name: r[mapping.name] || "",
      phone: r[mapping.phone] || "",
      note: r[mapping.note] || "",
    }))
    .filter((r) => r.name.trim() || r.phone.trim() || r.note.trim());
  if (!rows.length)
    throw new Error(
      "선택한 시트에 가져올 참여자가 없습니다. 시트와 제목 행을 확인해주세요.",
    );
  if (rows.length > LIMITS.participants)
    throw new Error("명단은 500명까지 가져올 수 있습니다.");
  return rows;
}
