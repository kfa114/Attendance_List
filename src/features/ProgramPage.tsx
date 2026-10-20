import type { ExportDownload } from "../domain/export";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Users,
  Monitor,
  ShieldCheck,
  Search,
  Settings2,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Phone,
  FileDown,
  ClipboardList,
  Clock3,
  Link2,
  Download,
} from "lucide-react";
import type {
  Bundle,
  Participant,
  Period,
  Role,
  Session,
} from "../domain/model";
import { PERIOD_LABEL, programPeriods } from "../domain/model";
import {
  canSign,
  displayPhone,
  formatDate,
  isClosed,
  koreaDate,
  stateFor,
} from "../domain/rules";
import { getBundle, request } from "../api";
import { Badge, Empty, Modal, Notice, Spinner } from "../components/ui";
import { SignatureDialog } from "../components/SignatureDialog";
import { ProgramEditor } from "./ProgramEditor";
import { Student } from "./Student";
export function ProgramPage({
  programId,
  adminToken,
  scopedToken,
  initialRole,
  back,
  toast,
}: {
  programId: string;
  adminToken: string;
  scopedToken?: string;
  initialRole: Role;
  back: () => void;
  toast: (s: string) => void;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [bundle, setBundle] = useState<Bundle>();
  const [title, setTitle] = useState("프로그램");
  const [publicEnabled, setPublicEnabled] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [selectedPeriod, setPeriod] = useState<Period>("am");
  const [query, setQuery] = useState("");
  const [adminTab, setAdminTab] = useState("attendance");
  const [editing, setEditing] = useState(false);
  const [signer, setSigner] = useState<Participant>();
  const [links, setLinks] = useState<{ student: string; tablet?: string }>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const latestLoad = useRef(0);
  const token = adminToken || scopedToken || "";
  const load = useCallback(
    async (quiet = false) => {
      const generation = ++latestLoad.current;
      try {
        if (!quiet) setError("");
        if (token) {
          const b = await getBundle(programId, token);
          if (generation !== latestLoad.current) return;
          setBundle(b);
          setTitle(b.program.title);
          setPublicEnabled(b.program.signatureEnabled);
          setDate((v) =>
            b.program.dates.includes(v)
              ? v
              : b.program.dates.find(
                  (d) => d >= koreaDate(new Date(b.serverNow)),
                ) ||
                b.program.dates.at(-1) ||
                "",
          );
        } else {
          const p = await request("publicProgram", { programId }, "");
          if (generation !== latestLoad.current) return;
          setTitle(p.title);
          setPublicEnabled(p.signatureEnabled);
        }
      } catch (e) {
        if (generation === latestLoad.current) setError((e as Error).message);
      }
    },
    [programId, token],
  );
  useEffect(() => {
    load();
    return () => {
      latestLoad.current++;
    };
  }, [load]);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(Date.now());
      if (document.visibilityState === "visible" && !signer && !editing)
        load(true);
    }, 20000);
    const focus = () => {
      if (!signer) load(true);
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [load, signer, editing]);
  async function mutate(action: string, data: any) {
    setBusy(true);
    setError("");
    try {
      await request(action, { programId, date, period, ...data }, token);
      await load(true);
      toast("저장했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openLinks() {
    setBusy(true);
    try {
      const s = await request<Session & { url: string }>(
        "tabletSession",
        { programId },
        adminToken,
      );
      const base = location.href.split("#")[0];
      const tablet = s.url.startsWith("#") ? `${base}${s.url}` : s.url;
      setLinks({
        student: `${tablet.split("#")[0]}#program=${encodeURIComponent(programId)}&role=student`,
        tablet,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const split = bundle?.program.signatureEnabled ?? publicEnabled;
  const periods = programPeriods({ signatureEnabled: split });
  const period: Period = split
    ? selectedPeriod === "single"
      ? "am"
      : selectedPeriod
    : "single";
  const shown =
    bundle?.participants.filter(
      (r) =>
        r.name.includes(query) ||
        (role === "admin" &&
          r.phone.includes(query.replace(/\D/g, "")) &&
          /\d/.test(query)),
    ) || [];
  const slotSignatures =
    bundle?.signatures.filter((s) => s.date === date && s.period === period) ||
    [];
  const isSigned = (id: string) =>
    slotSignatures.some((s) => s.participantId === id);
  const now = bundle
    ? new Date(
        new Date(bundle.serverNow).getTime() + Math.max(0, Date.now() - tick),
      )
    : new Date();
  const canWrite =
    bundle &&
    bundle.program.status === "active" &&
    date &&
    canSign(date, period, now);
  async function download(id: string) {
    setBusy(true);
    try {
      const f = await request<ExportDownload>(
        "downloadExport",
        { programId, exportId: id },
        adminToken,
      );
      const bytes =
        "format" in f
          ? await (await import("./pdf")).renderPdf(f.snapshot)
          : Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const slotControls = (
    <div className="slot-controls">
      <select
        aria-label="교육일 선택"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      >
        {bundle?.program.dates.map((d) => (
          <option key={d} value={d}>
            {formatDate(d)}
          </option>
        ))}
      </select>
      <div className="segmented">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={period === p ? "active" : ""}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      <span className="small muted">
        <Clock3 size={15} />
        {period === "am" ? "13:00" : "18:00"} 마감
      </span>
    </div>
  );
  const contacts = shown.filter(
    (r) =>
      !isSigned(r.id) &&
      !bundle?.decisions.some(
        (d) =>
          d.participantId === r.id && d.date === date && d.period === period,
      ) &&
      !bundle?.absences.some(
        (a) =>
          a.participantId === r.id &&
          a.date === date &&
          a.period === period &&
          a.absent,
      ),
  );
  return (
    <div className="program-page">
      <button className="back-link" onClick={back}>
        <ArrowLeft size={16} />
        {adminToken ? "명단 목록으로" : "처음으로"}
      </button>
      <div className="program-title-row">
        <div>
          <div className="eyebrow">PROGRAM WORKSPACE</div>
          <h1>{title}</h1>
          <div className="inline">
            <Badge color="blue">
              {split ? "오전·오후 서명 사용" : "기본 서명 사용"}
            </Badge>
            {bundle && (
              <span className="muted small">
                참여자 {bundle.participants.length}명
              </span>
            )}
          </div>
        </div>
        {adminToken && (
          <div className="inline">
            <button
              className="btn secondary"
              aria-label="전용 링크"
              disabled={busy}
              onClick={openLinks}
            >
              <Link2 size={16} />
              <span className="hide-small">전용 링크</span>
            </button>
            <button
              className="btn secondary"
              aria-label="프로그램 설정"
              onClick={() => setEditing(true)}
              disabled={!bundle}
            >
              <Settings2 size={16} />
              <span className="hide-small">설정</span>
            </button>
          </div>
        )}
      </div>
      <nav className="role-tabs" aria-label="역할 선택">
        {(
          [
            { id: "student", label: "교육생", icon: Users },
            { id: "tablet", label: "태블릿", icon: Monitor },
            { id: "admin", label: "강사·관리자", icon: ShieldCheck },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={role === t.id ? "active" : ""}
            onClick={() => {
              setRole(t.id);
              setQuery("");
            }}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </nav>
      {error && <Notice error>{error}</Notice>}
      {role === "student" ? (
        <Student key={programId} programId={programId} />
      ) : role === "admin" && !adminToken ? (
        <Empty
          title="관리자 인증이 필요해요"
          description="관리자 홈에서 로그인한 뒤 이 명단을 선택해주세요."
          action={back}
          label="관리자 로그인"
        />
      ) : !bundle ? (
        error ? (
          <button className="btn secondary" onClick={() => load()}>
            다시 불러오기
          </button>
        ) : (
          <Spinner />
        )
      ) : role === "tablet" ? (
        <section className="tablet-panel">
          <div className="section-line">
            <div>
              <h2>이름을 선택하고 서명해주세요</h2>
              <p className="muted">서명한 이름은 목록에서 사라져요.</p>
            </div>
            <Badge>
              {slotSignatures.length} / {bundle.participants.length}명 완료
            </Badge>
          </div>
          {!bundle.program.dates.length ? (
            <Empty
              title="등록된 교육일이 없어요"
              description="관리자에게 교육일 등록을 요청해주세요."
            />
          ) : (
            <>
              {slotControls}
              {!canWrite && (
                <Notice>
                  {date !== koreaDate(now)
                    ? "오늘 교육일의 서명만 받을 수 있어요."
                    : bundle.program.status === "archived"
                      ? "보관된 프로그램이에요."
                      : "서명이 마감됐어요. 미서명자는 강사에게 문의해주세요."}
                </Notice>
              )}
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="서명할 이름 검색"
                  placeholder="내 이름 찾기"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="name-grid">
                {shown
                  .filter((r) => !isSigned(r.id))
                  .map((r) => (
                    <button
                      className="name-card"
                      key={r.id}
                      disabled={!canWrite}
                      onClick={() => setSigner(r)}
                    >
                      <span>{String(r.order).padStart(2, "0")}</span>
                      <strong>{r.name}</strong>
                      <span className="sign-arrow">↗</span>
                    </button>
                  ))}
              </div>
              {!shown.filter((r) => !isSigned(r.id)).length && (
                <Empty
                  title={query ? "이름을 찾을 수 없어요" : "모두 서명했어요"}
                  description={
                    query
                      ? "이미 서명했거나 등록되지 않은 이름이에요."
                      : "선택한 교육일의 서명이 완료됐어요."
                  }
                />
              )}
            </>
          )}
        </section>
      ) : (
        <>
          <div className="admin-tabs">
            {[
              ["attendance", "출결 현황"],
              ["roster", "명단"],
              ["contact", "연락 관리"],
              ["exports", "출석부"],
              ["history", "작업 이력"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setAdminTab(id);
                  setQuery("");
                }}
                className={adminTab === id ? "active" : ""}
              >
                {label}
              </button>
            ))}
            <button
              className="icon-btn refresh"
              aria-label="새로고침"
              onClick={() => load()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {adminTab === "roster" ? (
            <section className="panel">
              <div className="section-line">
                <div>
                  <h3>
                    참여자 명단{" "}
                    <span className="count">
                      {bundle.participants.length}명
                    </span>
                  </h3>
                  <p className="small muted">이름·연락처·비고를 관리하세요.</p>
                </div>
                <button
                  className="btn secondary compact"
                  onClick={() => setEditing(true)}
                >
                  <Settings2 size={15} />
                  명단 수정
                </button>
              </div>
              <SearchBox query={query} set={setQuery} />
              <div className="table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>순번</th>
                      <th>이름</th>
                      <th>연락처</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td data-label="순번" className="muted">
                          {r.order}
                        </td>
                        <td data-label="이름">
                          <strong>{r.name}</strong>
                        </td>
                        <td data-label="연락처">
                          <a href={`tel:${r.phone}`}>{displayPhone(r.phone)}</a>
                        </td>
                        <td data-label="비고" className="muted">
                          {r.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : adminTab === "history" ? (
            <section className="panel">
              <h3>작업 이력</h3>
              {!bundle.audits.length ? (
                <p className="muted">기록된 작업이 없어요.</p>
              ) : (
                <div className="history">
                  {bundle.audits.map((a) => (
                    <div key={a.id}>
                      <span className="history-dot" />
                      <div>
                        <strong>{a.action}</strong>
                        <p>
                          {a.by} ·{" "}
                          {new Date(a.at).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : !bundle.program.dates.length ? (
            <Empty
              title="교육일을 등록해주세요"
              description="교육일을 등록하면 출결 관리를 시작할 수 있어요."
              action={() => setEditing(true)}
              label="교육일 설정"
            />
          ) : (
            <>
              {slotControls}
              {adminTab === "attendance" ? (
                <>
                  <div className="stats three">
                    <div className="stat">
                      <span>본인 서명 완료</span>
                      <strong>
                        {slotSignatures.length}
                        <small>명</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>강사 판단 대기</span>
                      <strong>
                        {
                          bundle.participants.filter(
                            (r) =>
                              !isSigned(r.id) &&
                              !bundle.decisions.some(
                                (d) =>
                                  d.participantId === r.id &&
                                  d.date === date &&
                                  d.period === period,
                              ),
                          ).length
                        }
                        <small>명</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>결석 신고</span>
                      <strong>
                        {
                          bundle.absences.filter(
                            (a) =>
                              a.date === date &&
                              a.period === period &&
                              a.absent,
                          ).length
                        }
                        <small>명</small>
                      </strong>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="section-line">
                      <h3>참여자별 출결</h3>
                      <Badge
                        color={isClosed(date, period, now) ? "gray" : "blue"}
                      >
                        {isClosed(date, period, now)
                          ? "서명 마감"
                          : "서명 가능 시간"}
                      </Badge>
                    </div>
                    <SearchBox query={query} set={setQuery} />
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>이름</th>
                            <th>결석 신고</th>
                            <th>출결 상태</th>
                            <th>미서명 판단</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((r) => {
                            const status = stateFor(bundle, r.id, date, period);
                            return (
                              <tr key={r.id}>
                                <td>
                                  <strong>{r.name}</strong>
                                  <small className="cell-note">
                                    {displayPhone(r.phone)}
                                  </small>
                                </td>
                                <td>
                                  {bundle.absences.some(
                                    (a) =>
                                      a.participantId === r.id &&
                                      a.date === date &&
                                      a.period === period &&
                                      a.absent,
                                  ) ? (
                                    <Badge color="orange">결석 신고</Badge>
                                  ) : (
                                    <span className="muted">출석 예정</span>
                                  )}
                                </td>
                                <td>
                                  <Badge
                                    color={
                                      isSigned(r.id)
                                        ? "green"
                                        : status === "강사 판단 출석"
                                          ? "blue"
                                          : status === "강사 판단 결석"
                                            ? "orange"
                                            : "gray"
                                    }
                                  >
                                    {status}
                                  </Badge>
                                </td>
                                <td>
                                  {isSigned(r.id) ? (
                                    <span className="small muted">
                                      <Check size={14} />
                                      본인 서명
                                    </span>
                                  ) : (
                                    <div className="inline">
                                      <button
                                        className="btn soft compact"
                                        disabled={
                                          busy ||
                                          date > koreaDate(now) ||
                                          bundle.program.status === "archived"
                                        }
                                        onClick={() =>
                                          mutate("decide", {
                                            participantId: r.id,
                                            result: "present",
                                          })
                                        }
                                      >
                                        출석
                                      </button>
                                      <button
                                        className="btn secondary compact"
                                        disabled={
                                          busy ||
                                          date > koreaDate(now) ||
                                          bundle.program.status === "archived"
                                        }
                                        onClick={() =>
                                          mutate("decide", {
                                            participantId: r.id,
                                            result: "absent",
                                          })
                                        }
                                      >
                                        결석
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="small muted footnote">
                      강사 판단은 출결 상태에 기록되며 서명 기준 출석률에는
                      반영되지 않아요.
                    </div>
                  </section>
                </>
              ) : adminTab === "contact" ? (
                <section className="panel">
                  <div className="section-line">
                    <div>
                      <h3>
                        연락이 필요한 사람{" "}
                        <span className="count">{contacts.length}명</span>
                      </h3>
                      <p className="small muted">
                        서명·강사 판단·결석 신고가 없는 참여자예요.
                      </p>
                    </div>
                    <Phone size={22} />
                  </div>
                  {!contacts.length ? (
                    <Empty
                      title="연락 대상이 없어요"
                      description="선택한 교육일과 서명 구분을 확인해주세요."
                    />
                  ) : (
                    <div className="contact-list">
                      {contacts.map((r) => {
                        const c = bundle.contacts.find(
                          (c) =>
                            c.participantId === r.id &&
                            c.date === date &&
                            c.period === period,
                        );
                        return (
                          <div
                            className="contact-row"
                            key={`${r.id}-${c?.updatedAt}`}
                          >
                            <div>
                              <strong>{r.name}</strong>
                              <a href={`tel:${r.phone}`}>
                                <Phone size={13} />
                                {displayPhone(r.phone)}
                              </a>
                            </div>
                            <input
                              aria-label={`${r.name} 연락 담당자`}
                              placeholder="담당자"
                              defaultValue={c?.assignee || ""}
                              maxLength={40}
                              disabled={
                                busy || bundle.program.status === "archived"
                              }
                              onBlur={(e) => {
                                if (e.target.value !== (c?.assignee || ""))
                                  mutate("contact", {
                                    participantId: r.id,
                                    assignee: e.target.value,
                                    result: c?.result || "",
                                  });
                              }}
                            />
                            <select
                              aria-label={`${r.name} 통화 결과`}
                              value={c?.result || ""}
                              disabled={
                                busy || bundle.program.status === "archived"
                              }
                              onChange={(e) =>
                                mutate("contact", {
                                  participantId: r.id,
                                  assignee: c?.assignee || "",
                                  result: e.target.value,
                                })
                              }
                            >
                              <option value="">결과 선택</option>
                              {[
                                "오는 중",
                                "결석 확인",
                                "연락 안 됨",
                                "연락 완료",
                              ].map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : adminTab === "exports" ? (
                <section className="panel">
                  <div className="section-line">
                    <div>
                      <h3>출석부 출력</h3>
                      <p className="small muted">
                        교육일별 서명을 한 장의 출석부로 정리해요.
                      </p>
                    </div>
                    <div className="inline">
                      <button
                        className="btn secondary"
                        onClick={() => setPreview(true)}
                      >
                        <ClipboardList size={16} />
                        미리보기
                      </button>
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() => mutate("createExport", {})}
                      >
                        <FileDown size={16} />
                        {busy ? "생성 중…" : "PDF 버전 생성"}
                      </button>
                    </div>
                  </div>
                  <div className="export-list">
                    {bundle.exports
                      .filter((e) => e.date === date)
                      .map((e) => (
                        <div key={e.id}>
                          <span>
                            <FileDown size={20} />
                            출석부 v{e.version}
                            <small>
                              {new Date(e.createdAt).toLocaleString("ko-KR", {
                                timeZone: "Asia/Seoul",
                              })}
                            </small>
                          </span>
                          <button
                            className="btn secondary compact"
                            disabled={busy}
                            onClick={() => download(e.id)}
                          >
                            <Download size={15} />
                            다운로드
                          </button>
                        </div>
                      ))}
                    {!bundle.exports.some((e) => e.date === date) && (
                      <Empty
                        title="아직 만든 출석부가 없어요"
                        description="미리보기를 확인하고 PDF 버전을 생성해주세요."
                      />
                    )}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
      {editing && bundle && (
        <ProgramEditor
          existing={bundle}
          close={() => setEditing(false)}
          saved={() => {
            setEditing(false);
            load();
            toast("프로그램 설정을 저장했습니다.");
          }}
        />
      )}
      {signer && (
        <SignatureDialog
          participant={signer}
          date={date}
          period={period}
          close={() => setSigner(undefined)}
          save={async (image, requestId) => {
            await request(
              "sign",
              {
                programId,
                participantId: signer.id,
                date,
                period,
                image,
                requestId,
              },
              token,
            );
            await load(true);
            toast("서명이 저장됐습니다.");
          }}
        />
      )}
      {links && (
        <Modal title="프로그램 전용 링크" close={() => setLinks(undefined)}>
          <div className="modal-body">
            <Notice>
              교육생에게는 교육생 링크만 전달해주세요. 태블릿 링크는 6시간 동안
              현장 서명에 사용할 수 있어요.
            </Notice>
            {[
              ["교육생 링크", links.student],
              ["현장 태블릿 링크", links.tablet],
            ].map(([label, url]) => (
              <label className="field" key={label}>
                {label}
                <div className="inline">
                  <input readOnly value={url} />
                  <button
                    className="btn secondary"
                    aria-label={`${label} 복사`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(url || "");
                        toast("링크를 복사했습니다.");
                      } catch {
                        toast("주소를 선택해 직접 복사해주세요.");
                      }
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </label>
            ))}
            <p className="small muted">
              태블릿 링크는 이름과 서명 기능을 포함하므로 현장 기기에서만
              사용해주세요.
            </p>
          </div>
        </Modal>
      )}
      {preview && bundle && (
        <Modal
          title={`${date} 출석부 미리보기`}
          close={() => setPreview(false)}
          wide
        >
          <div className="modal-body">
            <h3>{title}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>순번</th>
                    <th>이름</th>
                    {periods.map((p) => (
                      <th key={p}>{PERIOD_LABEL[p]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bundle.participants.map((r) => (
                    <tr key={r.id}>
                      <td>{r.order}</td>
                      <td>{r.name}</td>
                      {periods.map((p) => (
                        <td key={p}>{stateFor(bundle, r.id, date, p)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Notice>
              이 화면은 출결 상태 미리보기입니다. 저장된 버전을 다운로드하면
              실제 서명 이미지가 포함된 PDF를 만들어요.
            </Notice>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SearchBox({
  query,
  set,
}: {
  query: string;
  set: (v: string) => void;
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label="참여자 검색"
        value={query}
        onChange={(e) => set(e.target.value)}
        placeholder="이름 또는 연락처 검색"
      />
    </label>
  );
}
