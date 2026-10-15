import { isGas, request } from "./api";
type Importer = typeof import("./features/import");
declare global {
  interface Window {
    RosterImporter?: Importer;
  }
}
let pending: Promise<Importer> | undefined;
export function loadImporter(): Promise<Importer> {
  if (!pending)
    pending = (async () => {
      if (!isGas()) {
        const source = "/src/features/import.ts";
        return (await import(/* @vite-ignore */ source)) as Importer;
      }
      if (!window.RosterImporter) {
        const source = await request<string>("getImporter");
        const script = document.createElement("script");
        script.textContent = source;
        document.head.appendChild(script);
      }
      if (!window.RosterImporter)
        throw new Error(
          "파일 읽기 도구를 불러오지 못했습니다. 다시 시도해주세요.",
        );
      return window.RosterImporter;
    })().catch((e) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
