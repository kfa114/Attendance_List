import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  guessHeader,
  guessTitle,
  guessMapping,
  mapGrid,
  readFile,
} from "../src/features/import";
test("제목 행과 별칭 열 연결, 빈 행 제외, 연락처 문자열 보존", () => {
  const grid = [
    ["프로그램명"],
    ["성명", "휴대폰", "메모"],
    ["참여자", "010-0000-1234", "기록"],
    ["", "", ""],
  ];
  const h = guessHeader(grid);
  assert.equal(h, 1);
  const map = guessMapping(grid[h]);
  assert.deepEqual(map, { name: 0, phone: 1, note: 2 });
  assert.deepEqual(mapGrid(grid, h, map), [
    { name: "참여자", phone: "010-0000-1234", note: "기록" },
  ]);
});
for (const kind of ["xlsx", "xls", "csv", "ods"] as const)
  test(`${kind} 파일 실제 파싱과 앞자리 0 보존`, async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["이름", "연락처", "비고"],
        ["테스트", "01000001234", "가상"],
      ]),
      "명단",
    );
    const bytes = XLSX.write(book, { type: "buffer", bookType: kind });
    const file = new File([bytes], `명단.${kind}`);
    const read = await readFile(file);
    assert.equal(read.sheets[0].grid[1][1], "01000001234");
  });
test("확장자·용량 검증", async () => {
  await assert.rejects(() => readFile(new File(["x"], "bad.exe")));
  await assert.rejects(() =>
    readFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.xlsx")),
  );
});

test("UTF-8 CSV의 BOM 유무와 관계없이 한글·전화번호 원문 보존", async () => {
  for (const prefix of ["", "\ufeff"]) {
    const data = await readFile(
      new File(
        [`${prefix}이름,연락처,비고\n홍길동,01012345678,한글 메모\n`],
        "한글.csv",
      ),
    );
    assert.deepEqual(data.sheets[0].grid[0], ["이름", "연락처", "비고"]);
    assert.deepEqual(data.sheets[0].grid[1], [
      "홍길동",
      "01012345678",
      "한글 메모",
    ]);
  }
});
test("빈 파일·빈 통합문서·가짜 확장자·손상된 파일은 친절한 오류로 거절", async () => {
  await assert.rejects(() => readFile(new File([], "빈.csv")), /비어/);
  await assert.rejects(
    () => readFile(new File(["not an excel file"], "가짜.xlsx")),
    /형식|읽을 수/,
  );
  await assert.rejects(
    () =>
      readFile(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0])], "손상.xlsx")),
    /읽을 수|손상/,
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "빈 시트");
  await assert.rejects(
    () =>
      readFile(
        new File(
          [XLSX.write(book, { type: "buffer", bookType: "xlsx" })],
          "빈.xlsx",
        ),
      ),
    /비어/,
  );
});
test("띄어쓰기·줄바꿈·필수 표기가 있는 열과 보호자 연락처 구분", () => {
  assert.deepEqual(
    guessMapping(["성 명 *", "보호자 연락처", "휴대\n전화(필수)", "비 고"]),
    { name: 0, phone: 2, note: 3 },
  );
  assert.equal(
    guessHeader([
      ["명단 제목"],
      ["성 명", "연 락 처"],
      ["홍길동", "01012345678"],
    ]),
    1,
  );
});
test("선택하지 않은 열의 합계나 서식 잔여 행은 빈 참여자로 가져오지 않음", () => {
  assert.deepEqual(
    mapGrid(
      [
        ["이름", "연락처", "합계"],
        ["홍길동", "01012345678", ""],
        ["", "", "1"],
      ],
      0,
      { name: 0, phone: 1, note: -1 },
    ),
    [{ name: "홍길동", phone: "01012345678", note: "" }],
  );
});
test("같은 열 중복 연결·없는 열·잘못된 제목 행은 거절", () => {
  const grid = [
    ["이름", "연락처", "비고"],
    ["홍길동", "01012345678", ""],
  ];
  assert.throws(() => mapGrid(grid, 0, { name: 0, phone: 1, note: 1 }));
  assert.throws(() => mapGrid(grid, 0, { name: 0, phone: 8, note: -1 }));
  assert.throws(() => mapGrid(grid, 20, { name: 0, phone: 1, note: -1 }));
});

test("기존 한글 엑셀의 CP949 CSV도 정상 처리", async () => {
  const cptable = (await import("xlsx/dist/cpexcel.full.mjs")) as unknown as {
    utils: { encode: (codepage: number, text: string) => Uint8Array };
  };
  const bytes = cptable.utils.encode(
    949,
    "성명,연락처,비고\r\n김가상,01000001234,한글 메모",
  );
  const data = await readFile(new File([new Uint8Array(bytes)], "ANSI.csv"));
  assert.deepEqual(data.sheets[0].grid[1], [
    "김가상",
    "01000001234",
    "한글 메모",
  ]);
});
test("UTF-16 CSV와 따옴표·쉼표·줄바꿈이 있는 비고 보존", async () => {
  const csv = '이름,연락처,비고\r\n김가상,01000001234,"첫 줄, 메모\n둘째 줄"';
  const data = await readFile(
    new File(
      [Buffer.concat([Buffer.from([255, 254]), Buffer.from(csv, "utf16le")])],
      "UTF16.csv",
    ),
  );
  assert.equal(data.sheets[0].grid[1][2], "첫 줄, 메모\n둘째 줄");
});
test("시트 첫 행이 A1이 아니어도 실제 제목 행·열 번호 유지", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(
    sheet,
    [
      ["이름", "연락처"],
      ["가상", "01000001234"],
    ],
    { origin: "B5" },
  );
  XLSX.utils.book_append_sheet(book, sheet, "명단");
  const file = await readFile(
    new File(
      [XLSX.write(book, { type: "buffer", bookType: "xlsx" })],
      "위치.xlsx",
    ),
  );
  assert.equal(guessHeader(file.sheets[0].grid), 4);
  assert.deepEqual(guessMapping(file.sheets[0].grid[4]), {
    name: 1,
    phone: 2,
    note: -1,
  });
});
test("21행 이후 제목도 찾고 불완전한 앞선 제목보다 전체 열이 있는 행 선택", () => {
  const grid = Array.from({ length: 30 }, () => [""]);
  grid[0] = ["이름"];
  grid[24] = ["이름", "연락처", "비고"];
  grid[25] = ["가상", "01000001234", ""];
  assert.equal(guessHeader(grid), 24);
});
test("빈 첫 시트·설명 시트 대신 명단 시트를 기본 선택", async () => {
  const { suggestSheet } = await import("../src/features/import");
  assert.equal(
    suggestSheet({
      name: "테스트.xlsx",
      sheets: [
        { name: "빈 시트", grid: [] },
        { name: "설명", grid: [["사용 방법"]] },
        {
          name: "명단",
          grid: [
            ["성명", "연락처"],
            ["가상", "01000001234"],
          ],
        },
      ],
    }),
    2,
  );
});
test("엑셀 사용자 지정 표시 형식의 앞자리 0 보존", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["이름", "연락처"],
    ["가상", 1000001234],
  ]);
  sheet.B2.z = "000-0000-0000";
  XLSX.utils.book_append_sheet(book, sheet, "명단");
  const data = await readFile(
    new File(
      [XLSX.write(book, { type: "buffer", bookType: "xlsx" })],
      "서식.xlsx",
    ),
  );
  assert.equal(data.sheets[0].grid[1][1], "010-0000-1234");
});
test("이미 숫자로 저장돼 0이 없는 전화번호를 임의로 고치지 않음", async () => {
  const { rowError } = await import("../src/domain/rules");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["이름", "연락처"],
      ["가상", 1000001234],
    ]),
    "명단",
  );
  const data = await readFile(
    new File(
      [XLSX.write(book, { type: "buffer", bookType: "xlsx" })],
      "숫자.xlsx",
    ),
  );
  const row = mapGrid(data.sheets[0].grid, 0, {
    name: 0,
    phone: 1,
    note: -1,
  })[0];
  assert.equal(row.phone, "1000001234");
  assert.match(rowError(row), /연락처/);
});
test("500명 허용·501명 거절, 참여자 없는 선택 시트도 거절", () => {
  const rows = Array.from({ length: 500 }, (_, i) => [
    `참여자${i}`,
    "01000001234",
  ]);
  const grid = [["이름", "연락처"], ...rows];
  assert.equal(mapGrid(grid, 0, { name: 0, phone: 1, note: -1 }).length, 500);
  assert.throws(
    () =>
      mapGrid([...grid, ["추가", "01000001234"]], 0, {
        name: 0,
        phone: 1,
        note: -1,
      }),
    /500/,
  );
  assert.throws(
    () => mapGrid([["이름", "연락처"]], 0, { name: 0, phone: 1, note: -1 }),
    /참여자가 없/,
  );
});
test("2,000행·100열 제한은 전체 시트 변환 전에 검사", async () => {
  for (const cell of ["A2001", "CW1"]) {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["이름", "연락처"]]);
    sheet[cell] = { t: "s", v: "초과" };
    sheet["!ref"] = `A1:${cell}`;
    XLSX.utils.book_append_sheet(book, sheet, "명단");
    await assert.rejects(
      () =>
        readFile(
          new File(
            [XLSX.write(book, { type: "buffer", bookType: "xlsx" })],
            `${cell}.xlsx`,
          ),
        ),
      /2,000행|100열/,
    );
  }
});

test("파일명이 아닌 최상단 제목을 가져오고 부제는 합치지 않음", () => {
  const grid = [
    ["2026 지역학교 양성과정 2기", "", ""],
    ["최종 합격 명단(내부용)"],
    [],
    ["번호", "이름", "전화번호"],
    ["1", "가상참여자", "01000000001"],
  ];
  assert.equal(guessTitle(grid), "2026 지역학교 양성과정 2기");
});
test("제목 없는 명단은 열 이름이나 참여자를 제목으로 사용하지 않음", () => {
  assert.equal(
    guessTitle([
      ["이름", "연락처"],
      ["참여자", "01000000001"],
    ]),
    "",
  );
  assert.equal(guessTitle([]), "");
});
test("상단 빈 행·작성일·안내 제외, 명시적인 프로그램명 셀 지원", () => {
  assert.equal(
    guessTitle([
      [],
      ["작성일: 2026-10-15"],
      ["안내: 내용을 확인하세요"],
      ["프로그램명", "지역 교육 프로그램"],
      ["이름", "연락처"],
    ]),
    "지역 교육 프로그램",
  );
  assert.equal(
    guessTitle([["2026-10-15"], ["지역\n교육"], ["이름", "연락처"]]),
    "지역 교육",
  );
});
test("사용자가 변경한 열 제목 행에 맞춰 제목 탐색 범위를 제한", () => {
  const grid = [["이름", "연락처"], ["가상참여자"], ["이름", "연락처"]];
  assert.equal(guessTitle(grid, 0), "");
});
