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
  const left = 14,
    tableWidth = 182,
    bottom = 282;
  const columns = single ? [16, 43, 68, 55] : [14, 38, 43, 43, 44];
  const labels = single
    ? ["순번", "이름", "서명", "비고"]
    : ["순번", "이름", "오전 서명", "오후 서명", "비고"];
  doc.setFontSize(16);
  const titleLines: string[] = doc.splitTextToSize(snapshot.title, tableWidth);
  const tableTop = 17 + (titleLines.length - 1) * 7 + 12;
  const rowHeight = Math.min(8, (bottom - tableTop - 8) / 30);
  let y = 0,
    pageRows = 0;
  function header() {
    doc.setTextColor(20);
    doc.setFontSize(16);
    doc.setLineWidth(0.12);
    doc.text(titleLines, 105, 17, {
      align: "center",
      renderingMode: "fillThenStroke",
    });
    doc.setFontSize(9);
    doc.text(`교육일: ${snapshot.date}`, 105, tableTop - 4, {
      align: "center",
    });
    y = tableTop;
    let x = left;
    doc.setDrawColor(60);
    doc.setLineWidth(0.22);
    doc.setFontSize(10);
    labels.forEach((label, i) => {
      doc.setFillColor(239, 239, 239);
      doc.rect(x, y, columns[i], 8, "FD");
      doc.text(label, x + columns[i] / 2, y + 4, {
        align: "center",
        baseline: "middle",
      });
      x += columns[i];
    });
    y += 8;
    pageRows = 0;
  }
  function remark(row: AttendanceSnapshot["rows"][number]) {
    const statuses = single
      ? !row.single &&
        row.singleStatus?.startsWith("강사 판단 ") &&
        row.singleStatus !== "강사 판단 대기"
        ? [row.singleStatus]
        : []
      : [
          [row.am, row.amStatus, "오전"],
          [row.pm, row.pmStatus, "오후"],
        ]
          .filter(
            ([image, status]) =>
              !image &&
              status?.startsWith("강사 판단 ") &&
              status !== "강사 판단 대기",
          )
          .map(([, status, label]) => `${label}: ${status}`);
    return [row.note || "", ...statuses].filter(Boolean).join("\n");
  }
  function textCell(
    text: string[],
    x: number,
    width: number,
    height: number,
    size: number,
    lineHeight: number,
  ) {
    doc.setFontSize(size);
    const start = y + (height - (text.length - 1) * lineHeight) / 2;
    text.forEach((line, i) =>
      doc.text(line, x + width / 2, start + i * lineHeight, {
        align: "center",
        baseline: "middle",
      }),
    );
  }
  header();
  snapshot.rows.forEach((row) => {
    doc.setFontSize(10.5);
    const names: string[] = doc.splitTextToSize(row.name, columns[1] - 4);
    doc.setFontSize(8);
    const remarks: string[] = doc.splitTextToSize(
      remark(row),
      columns.at(-1)! - 4,
    );
    const height = Math.max(
      rowHeight,
      names.length * 4.1 + 2,
      remarks.length * 3.2 + 1.2,
    );
    if (pageRows >= 30 || y + height > bottom + 0.001) {
      doc.addPage();
      header();
    }
    let x = left;
    doc.setDrawColor(60);
    doc.setLineWidth(0.22);
    columns.forEach((width) => {
      doc.rect(x, y, width, height);
      x += width;
    });
    textCell([String(row.order)], left, columns[0], height, 10, 4);
    textCell(names, left + columns[0], columns[1], height, 10.5, 4.1);
    const images = single ? [row.single] : [row.am, row.pm];
    x = left + columns[0] + columns[1];
    images.forEach((image, i) => {
      const width = columns[i + 2];
      if (image) {
        const info = doc.getImageProperties(image);
        const ratio = info.height / info.width;
        let w = width - 4,
          h = w * ratio;
        if (h > height - 1.5) {
          h = height - 1.5;
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
      }
      x += width;
    });
    textCell(remarks, x, columns.at(-1)!, height, 8, 3.2);
    y += height;
    pageRows++;
  });
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${page} / ${count}`, 105, 290, { align: "center" });
  }
  return doc.output("arraybuffer");
}
export async function renderPdf(
  snapshot: AttendanceSnapshot,
): Promise<ArrayBuffer> {
  const fontData = await koreanFont();
  const cache = new Map<string, string>();
  const rows = [];
  for (const original of snapshot.rows) {
    const row = { ...original };
    for (const key of ["single", "am", "pm"] as const) {
      const image = row[key];
      if (!image) continue;
      if (!cache.has(image)) cache.set(image, await cropSignature(image));
      row[key] = cache.get(image)!;
    }
    rows.push(row);
  }
  return buildPdf({ ...snapshot, rows }, fontData);
}

/** Ignore white/transparent margins so handwriting stays legible in compact rows. */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        data[i + 3] > 32 &&
        Math.min(data[i], data[i + 1], data[i + 2]) < 220
      ) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < left) return null;
  const padding = 3;
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
async function cropSignature(source: string) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const bounds = inkBounds(
    ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
  );
  if (!bounds) return source;
  const trimmed = document.createElement("canvas");
  trimmed.width = bounds.width;
  trimmed.height = bounds.height;
  const target = trimmed.getContext("2d")!;
  target.fillStyle = "white";
  target.fillRect(0, 0, trimmed.width, trimmed.height);
  target.drawImage(
    canvas,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return trimmed.toDataURL("image/png");
}
