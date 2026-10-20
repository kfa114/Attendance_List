import type { ExportDownload } from "../src/domain/export";
import type { Session, Table } from "../src/domain/model";
export interface Repository {
  list<T>(table: Table, programId?: string): T[];
  put(table: Table, record: any): void;
  putMany(table: Table, records: any[]): void;
  remove(table: Table, id: string): void;
  lock<T>(fn: () => T): T;
}
export interface Runtime {
  now(): Date;
  id(): string;
  session(token: string): Session | null;
  saveSession(session: Session): void;
  deleteSession(token: string): void;
  adminLogin(secret: string): boolean;
  throttle(key: string): void;
  clearThrottle(key: string): void;
  putImage(dataUrl: string, name: string): string;
  image(fileId: string): string;
  removeFile(fileId: string): void;
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
  ): { fileId: string };
  pdf(fileId: string): ExportDownload;
  importer(): string;
  appUrl(): string;
  platform?(): "cloudflare" | "gas" | "local";
}
