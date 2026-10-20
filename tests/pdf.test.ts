import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPdf } from "../src/features/pdf";
const font = fs
  .readFileSync("public/fonts/NanumGothic-Regular.ttf")
  .toString("base64");
test("한글 글꼴이 포함된 실제 PDF 생성, 500명은 여러 페이지로 분할", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    order: i + 1,
    name: `가상 교육생 ${i + 1}`,
    singleMode: true,
    single: "",
    singleStatus: "강사 판단 대기",
    am: "",
    pm: "",
    amStatus: "",
    pmStatus: "",
  }));
  const bytes = Buffer.from(
    buildPdf(
      { title: "2026 지역 교육 출석부", date: "2026-10-20", rows },
      font,
    ),
  );
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(
    (bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length > 1,
  );
  assert.ok(bytes.includes(Buffer.from("/FontFile2")));
});
