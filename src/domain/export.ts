export interface PdfRow {
  order: number;
  name: string;
  note?: string;
  singleMode?: boolean;
  single?: string;
  singleStatus?: string;
  am: string;
  pm: string;
  amStatus: string;
  pmStatus: string;
}
export interface AttendanceSnapshot {
  title: string;
  date: string;
  rows: PdfRow[];
}
export type ExportDownload =
  | { base64: string; name: string }
  | {
      format: "attendance-snapshot";
      name: string;
      snapshot: AttendanceSnapshot;
    };
