import { jsPDF } from "jspdf";
import type { AttendanceSnapshot } from "../domain/export";
let font: Promise<string> | undefined;
async function koreanFont() {
  if (!font)
    font = fetch("/fonts/NanumGothic-Regular.ttf")
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            "PDF 한글 글꼴을 불러오지 못했습니다. 다시 시도해주세요.",
          );
        const bytes = new Uint8Array(await r.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      })
      .catch((e) => {
        font = undefined;
        throw e;
      });
  return font;
}
export function buildPdf(
  snapshot: AttendanceSnapshot,
  fontData: string,
): ArrayBuffer {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS("NanumGothic.ttf", fontData);
  doc.addFont("NanumGothic.ttf", "NanumGothic", "normal");
  doc.setFont("NanumGothic");
  const single = snapshot.rows[0]?.singleMode;
  const columns = single ? [14, 46, 126] : [14, 46, 63, 63];
  const labels = single
    ? ["순번", "이름", "서명"]
    : ["순번", "이름", "오전", "오후"];
  let y = 15,
    page = 0;
  const titleLines = doc.splitTextToSize(snapshot.title, 186);
  function header() {
    page++;
    doc.setFontSize(14);
    doc.text(titleLines, 12, 15);
    y = 15 + titleLines.length * 6;
    doc.setFontSize(9);
    doc.text(`교육일 ${snapshot.date} · 출석부 ${page}쪽`, 12, y);
    y += 6;
    let x = 12;
    doc.setDrawColor(190);
    doc.setFillColor(236, 243, 255);
    labels.forEach((label, i) => {
      doc.setFillColor(236, 243, 255);
      doc.rect(x, y, columns[i], 9, "FD");
      doc.text(label, x + 2, y + 6);
      x += columns[i];
    });
    y += 9;
  }
  header();
  snapshot.rows.forEach((row) => {
    const names = doc.splitTextToSize(row.name, 42);
    const height = Math.max(22, names.length * 4 + 6);
    if (y + height > 280) {
      doc.addPage();
      header();
    }
    let x = 12;
    columns.forEach((width) => {
      doc.rect(x, y, width, height);
      x += width;
    });
    doc.setFontSize(9);
    doc.text(String(row.order), 14, y + 7);
    doc.text(names, 28, y + 7);
    const cells = single
      ? [[row.single, row.singleStatus]]
      : [
          [row.am, row.amStatus],
          [row.pm, row.pmStatus],
        ];
    x = 72;
    cells.forEach(([image, status], i) => {
      const width = columns[i + 2];
      if (image) {
        const info = doc.getImageProperties(image);
        const ratio = info.height / info.width;
        let w = width - 6,
          h = w * ratio;
        if (h > height - 4) {
          h = height - 4;
          w = h / ratio;
        }
        doc.addImage(
          image,
          "PNG",
          x + (width - w) / 2,
          y + (height - h) / 2,
          w,
          h,
          undefined,
          "FAST",
        );
      } else {
        doc.text(doc.splitTextToSize(status || "", width - 4), x + 2, y + 7);
      }
      x += width;
    });
    y += height;
  });
  return doc.output("arraybuffer");
}
export async function renderPdf(
  snapshot: AttendanceSnapshot,
): Promise<ArrayBuffer> {
  return buildPdf(snapshot, await koreanFont());
}
