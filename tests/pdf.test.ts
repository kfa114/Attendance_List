import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPdf, inkBounds } from "../src/features/pdf";
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

for (const singleMode of [true, false]) {
  test(`${singleMode ? "기본" : "오전·오후"} 서명 30명은 A4 한 페이지, 31명은 두 페이지`, () => {
    for (const [count, expectedPages] of [
      [30, 1],
      [31, 2],
      [60, 2],
      [61, 3],
    ]) {
      const rows = Array.from({ length: count }, (_, i) => ({
        order: i + 1,
        name: "가상교육생",
        singleMode,
        am: "",
        pm: "",
        single: "",
        amStatus: "강사 판단 출석",
        pmStatus: "강사 판단 결석",
        singleStatus: "강사 판단 대기",
      }));
      const pdf = Buffer.from(
        buildPdf(
          { title: "2026 지역 교육 프로그램 출석부", date: "2026-10-20", rows },
          font,
        ),
      );
      assert.equal(
        (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
        expectedPages,
      );
    }
  });
}
test("최대 길이 제목에서도 일반 명단 30명을 한 페이지에 배치", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    order: i + 1,
    name: "가상교육생",
    singleMode: true,
    am: "",
    pm: "",
    single: "",
    amStatus: "",
    pmStatus: "",
  }));
  const bytes = Buffer.from(
    buildPdf({ title: "가".repeat(100), date: "2026-10-20", rows }, font),
  );
  assert.equal(
    (bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
    1,
  );
});
test("서명 여백 제거는 투명/흰 배경을 무시하고 잉크와 가장자리 여유를 보존", () => {
  const pixels = new Uint8ClampedArray(100 * 50 * 4).fill(255);
  assert.equal(inkBounds(pixels, 100, 50), null);
  for (let y = 20; y <= 25; y++)
    for (let x = 30; x <= 70; x++) {
      const i = (y * 100 + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 20;
    }
  assert.deepEqual(inkBounds(pixels, 100, 50), {
    left: 27,
    top: 17,
    width: 47,
    height: 12,
  });
  pixels[0] = pixels[1] = pixels[2] = 0;
  pixels[3] = 0;
  assert.deepEqual(inkBounds(pixels, 100, 50), {
    left: 27,
    top: 17,
    width: 47,
    height: 12,
  });
  pixels[3] = 255;
  assert.deepEqual(inkBounds(pixels, 100, 50), {
    left: 0,
    top: 0,
    width: 74,
    height: 29,
  });
});
