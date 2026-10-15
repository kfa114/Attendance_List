import { useState, useRef } from "react";
import {
  Upload,
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
  FileSpreadsheet,
  CalendarDays,
  PenLine,
  Check,
  LoaderCircle,
} from "lucide-react";
import { Modal, Notice } from "../components/ui";
import type { Bundle, DraftRow, Program } from "../domain/model";
import { rowError, koreaDate, LIMITS } from "../domain/rules";
import { request } from "../api";
import type { ImportedFile } from "./import";
import { loadImporter } from "../loadImporter";
const blank = (): DraftRow => ({ name: "", phone: "", note: "" });
export function ProgramEditor({
  close,
  saved,
  existing,
}: {
  close: () => void;
  saved: (p: Program) => void;
  existing?: Bundle;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"manual" | "file">("manual");
  const [title, setTitle] = useState(existing?.program.title || "");
  const [enabled, setEnabled] = useState(
    existing?.program.signatureEnabled ?? true,
  );
  const [dates, setDates] = useState(existing?.program.dates || []);
  const [newDate, setNewDate] = useState(koreaDate());
  const [rows, setRows] = useState<DraftRow[]>(
    existing?.participants.map((r) => ({
      name: r.name,
      phone: r.phone,
      note: r.note,
    })) || [blank(), blank(), blank()],
  );
  const [status, setStatus] = useState(existing?.program.status || "active");
  const [file, setFile] = useState<ImportedFile>();
  const [detectedTitle, setDetectedTitle] = useState("");
  const [sheet, setSheet] = useState(0);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState({ name: -1, phone: -1, note: -1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadGeneration = useRef(0);
  const validRows = rows.filter(
    (r) => r.name.trim() || r.phone.trim() || r.note.trim(),
  );
  async function loadFile(f?: File) {
    if (!f) return;
    const generation = ++uploadGeneration.current;
    setBusy(true);
    setError("");
    setFile(undefined);
    try {
      const lib = await loadImporter();
      const data = await lib.readFile(f);
      if (generation !== uploadGeneration.current) return;
      const selected = lib.suggestSheet(data);
      const h = lib.guessHeader(data.sheets[selected].grid);
      setFile(data);
      setHeader(h);
      setSheet(selected);
      setMapping(lib.guessMapping(data.sheets[selected].grid[h] || []));
      const extracted = lib.guessTitle(data.sheets[selected].grid, h);
      setDetectedTitle(extracted);
      setTitle(
        (current) => extracted || (current === detectedTitle ? "" : current),
      );
    } catch (e) {
      if (generation === uploadGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === uploadGeneration.current) setBusy(false);
    }
  }
  async function useMapping() {
    if (!file) return;
    setError("");
    try {
      const lib = await loadImporter();
      const imported = lib.mapGrid(file.sheets[sheet].grid, header, mapping);
      setRows(imported);
      setValidated(true);
      setFile(undefined);
      setMode("manual");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function changeSheet(i: number, h?: number) {
    if (!file) return;
    try {
      const lib = await loadImporter();
      const index = h ?? lib.guessHeader(file.sheets[i].grid);
      setSheet(i);
      setHeader(index);
      setMapping(lib.guessMapping(file.sheets[i].grid[index] || []));
      const extracted = lib.guessTitle(file.sheets[i].grid, index);
      setDetectedTitle(extracted);
      setTitle(
        (current) => extracted || (current === detectedTitle ? "" : current),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function update(i: number, key: keyof DraftRow, value: string) {
    setRows(rows.map((r, index) => (index === i ? { ...r, [key]: value } : r)));
  }
  async function submit() {
    setError("");
    setValidated(true);
    if (!title.trim()) return setError("프로그램명을 입력해주세요.");
    if (!validRows.length) return setError("참여자를 한 명 이상 입력해주세요.");
    if (validRows.some((r) => rowError(r)))
      return setError("표시된 입력 내용을 확인해주세요.");
    setBusy(true);
    try {
      const data = {
        title,
        signatureEnabled: enabled,
        dates,
        participants: validRows,
        ...(existing
          ? {
              programId: existing.program.id,
              revision: existing.program.revision,
              participantIds: rows
                .map((r, i) => ({ r, id: existing.participants[i]?.id || "" }))
                .filter(
                  ({ r }) => r.name.trim() || r.phone.trim() || r.note.trim(),
                )
                .map((r) => r.id),
              status,
            }
          : {}),
      };
      const p = await request<Program>(
        existing ? "updateProgram" : "createProgram",
        data,
      );
      saved(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const duplicates = validRows.some((r, i) =>
    validRows.some(
      (q, j) =>
        i !== j &&
        r.phone &&
        r.phone.replace(/\D/g, "") === q.phone.replace(/\D/g, ""),
    ),
  );
  return (
    <Modal
      title={existing ? "명단·프로그램 설정" : "새 명단 만들기"}
      close={() => {
        if (
          !busy &&
          window.confirm(
            "입력 화면을 닫을까요? 저장하지 않은 내용은 사라집니다.",
          )
        )
          close();
      }}
      wide
    >
      <div className="steps">
        <span className={step === 1 ? "active" : "done"}>
          <b>{step > 1 ? <Check size={13} /> : "1"}</b>프로그램 설정
        </span>
        <i />
        <span className={step === 2 ? "active" : ""}>
          <b>2</b>명단 작성
        </span>
      </div>
      <div className="modal-body">
        {error && <Notice error>{error}</Notice>}
        {step === 1 ? (
          <div className="editor-basics">
            <div>
              <span className="eyebrow">PROGRAM DETAILS</span>
              <h3>어떤 프로그램인가요?</h3>
              <p className="muted">
                프로그램명과 출석 관리 방식을 설정해주세요.
              </p>
            </div>
            <label className="field">
              프로그램명{" "}
              <span className="optional">
                파일에서 자동으로 가져올 수 있어요
              </span>
              <input
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 2026 영덕 해녀·해남학교 2기 출결"
                autoFocus
              />
            </label>
            <div className="setting-card">
              <div className="setting-icon">
                <PenLine size={21} />
              </div>
              <div>
                <strong>오전·오후 서명 사용</strong>
                <p>
                  {enabled
                    ? "교육일마다 오전과 오후 서명을 각각 받아요."
                    : "교육일마다 오전·오후 구분 없이 서명 한 번을 받아요."}
                </p>
              </div>
              <button
                type="button"
                className={`switch ${enabled ? "on" : ""}`}
                role="switch"
                aria-checked={enabled}
                aria-label="오전·오후 서명 사용"
                onClick={() => setEnabled(!enabled)}
              >
                <span />
              </button>
            </div>
            <section className="schedule">
              <label className="field">
                교육일 <span className="optional">나중에 추가할 수 있어요</span>
              </label>
              <div className="inline">
                <input
                  aria-label="추가할 교육일"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                <button
                  className="btn secondary"
                  onClick={() => {
                    if (newDate)
                      setDates([...new Set([...dates, newDate])].sort());
                  }}
                >
                  <Plus size={16} />
                  추가
                </button>
              </div>
              <div className="date-chips">
                {dates.map((d) => (
                  <button
                    key={d}
                    className="date-chip"
                    onClick={() => setDates(dates.filter((x) => x !== d))}
                    aria-label={`${d} 교육일 제거`}
                  >
                    {d}
                    <span>×</span>
                  </button>
                ))}
              </div>
              <div className="small muted">
                <CalendarDays size={15} />{" "}
                {enabled
                  ? "오전 13:00 · 오후 18:00 마감 (한국 시간)"
                  : "기본 서명 18:00 마감 (한국 시간)"}
              </div>
            </section>
            {existing && (
              <label className="field">
                운영 상태
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                >
                  <option value="active">운영 중</option>
                  <option value="archived">보관</option>
                </select>
              </label>
            )}
          </div>
        ) : (
          <>
            <label className="field">
              프로그램명 <span className="required">*</span>
              <input
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="파일 상단에서 가져오거나 직접 입력해주세요"
              />
              <span className="small muted">
                {detectedTitle
                  ? "파일 상단의 제목을 자동으로 가져왔어요. 저장 전에 수정할 수 있어요."
                  : "파일 상단에 제목이 있으면 자동으로 가져와요. 없으면 직접 입력해주세요."}
              </span>
            </label>
            {!existing && (
              <div className="input-method">
                <button
                  className={mode === "manual" ? "active" : ""}
                  onClick={() => setMode("manual")}
                >
                  <PenLine size={18} />
                  직접 입력
                </button>
                <button
                  className={mode === "file" ? "active" : ""}
                  onClick={() => setMode("file")}
                >
                  <Upload size={18} />
                  파일로 가져오기
                </button>
              </div>
            )}
            {mode === "file" && !file && (
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  loadFile(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-icon">
                  <FileSpreadsheet size={31} />
                </div>
                <h3>엑셀·스프레드시트 파일을 가져오세요</h3>
                <p>여기에 파일을 놓거나 아래 버튼으로 선택해주세요.</p>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  {busy ? "파일 읽는 중…" : "파일 선택"}
                </button>
                <small>XLSX, XLS, CSV, ODS · 최대 5MB / 500명</small>
                <input
                  ref={input}
                  type="file"
                  accept=".xlsx,.xls,.csv,.ods"
                  hidden
                  onChange={(e) => {
                    const selected = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    loadFile(selected);
                  }}
                />
              </div>
            )}
            {file && mode === "file" && (
              <div className="mapping">
                <Notice>
                  {file.name} · 열을 확인한 후 명단에 적용해주세요. 연락처는
                  앞자리 0이 보이는지 확인해주세요.
                </Notice>
                <button
                  className="btn secondary compact"
                  onClick={() => {
                    setFile(undefined);
                    setError("");
                  }}
                >
                  다른 파일 선택
                </button>
                <div className="form-grid">
                  <label className="field">
                    시트
                    <select
                      value={sheet}
                      onChange={(e) => changeSheet(Number(e.target.value))}
                    >
                      {file.sheets.map((s, i) => (
                        <option key={s.name} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    제목 행
                    <select
                      value={header}
                      onChange={(e) =>
                        changeSheet(sheet, Number(e.target.value))
                      }
                    >
                      {file.sheets[sheet].grid.map((_, i) => (
                        <option key={i} value={i}>
                          {i + 1}행
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid three">
                  {(["name", "phone", "note"] as const).map((key, i) => (
                    <label className="field" key={key}>
                      {["이름 열 *", "연락처 열 *", "비고 열"][i]}
                      <select
                        value={mapping[key]}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            [key]: Number(e.target.value),
                          })
                        }
                      >
                        <option value={-1}>선택 안 함</option>
                        {(file.sheets[sheet].grid[header] || []).map(
                          (cell, j) => (
                            <option key={j} value={j}>
                              {j + 1}열: {cell || "(빈 제목)"}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="import-preview">
                  {file.sheets[sheet].grid
                    .slice(header + 1, header + 5)
                    .map((r, i) => (
                      <div key={i}>{r.join(" · ")}</div>
                    ))}
                </div>
                <button className="btn primary" onClick={useMapping}>
                  편집 가능한 명단으로 가져오기
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            {mode === "manual" && (
              <>
                <div className="section-line">
                  <div>
                    <h3>
                      참여자 명단{" "}
                      <span className="count">{validRows.length}명</span>
                    </h3>
                    <p className="muted small">
                      이름과 연락처는 필수 항목이에요.
                    </p>
                  </div>
                  <button
                    className="btn secondary compact"
                    onClick={() => setRows([...rows, blank()])}
                    disabled={rows.length >= LIMITS.participants}
                  >
                    <Plus size={16} />행 추가
                  </button>
                </div>
                {duplicates && (
                  <Notice>
                    같은 연락처가 있습니다. 서로 다른 참여자가 맞는지
                    확인해주세요.
                  </Notice>
                )}
                <div className="roster-editor">
                  <div className="roster-editor-head">
                    <span>순번</span>
                    <span>이름 *</span>
                    <span>연락처 *</span>
                    <span>비고</span>
                    <span />
                  </div>
                  {rows.map((r, i) => (
                    <div className="edit-row" key={i}>
                      <span className="row-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <label>
                        <span className="mobile-label">이름</span>
                        <input
                          aria-label={`${i + 1}번 이름`}
                          value={r.name}
                          onChange={(e) => update(i, "name", e.target.value)}
                          placeholder="이름"
                          maxLength={60}
                        />
                      </label>
                      <label>
                        <span className="mobile-label">연락처</span>
                        <input
                          aria-label={`${i + 1}번 연락처`}
                          value={r.phone}
                          onChange={(e) => update(i, "phone", e.target.value)}
                          placeholder="010-1234-5678"
                          inputMode="tel"
                        />
                      </label>
                      <label>
                        <span className="mobile-label">비고</span>
                        <input
                          aria-label={`${i + 1}번 비고`}
                          value={r.note}
                          onChange={(e) => update(i, "note", e.target.value)}
                          placeholder="선택 입력"
                          maxLength={500}
                        />
                      </label>
                      {!existing && (
                        <button
                          className="icon-btn"
                          aria-label={`${i + 1}번 행 삭제`}
                          onClick={() =>
                            setRows(rows.filter((_, j) => j !== i))
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      {validated &&
                        (r.name || r.phone || r.note) &&
                        rowError(r) && (
                          <span className="row-error">{rowError(r)}</span>
                        )}
                    </div>
                  ))}
                </div>
                <button
                  className="add-row"
                  onClick={() => setRows([...rows, blank()])}
                  disabled={rows.length >= 500}
                >
                  <Plus size={16} />
                  참여자 추가
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <span className="small muted">
          {step === 1
            ? "설정은 나중에 변경할 수 있어요."
            : `총 ${validRows.length}명의 명단을 저장해요.`}
        </span>
        <div className="inline">
          {step === 2 && (
            <button
              className="btn secondary"
              onClick={() => setStep(1)}
              disabled={busy}
            >
              <ArrowLeft size={16} />
              이전
            </button>
          )}
          {step === 1 ? (
            <button
              className="btn primary"
              onClick={() => {
                setStep(2);
                setError("");
              }}
            >
              명단 작성
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || mode === "file"}
              onClick={submit}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              {busy ? "저장 중…" : existing ? "변경 저장" : "명단 생성"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
