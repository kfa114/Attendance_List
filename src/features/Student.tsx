import { useEffect, useState } from "react";
import { ArrowRight, LogOut, CalendarDays } from "lucide-react";
import type { Bundle, Period, Session } from "../domain/model";
import { PERIOD_LABEL, programPeriods } from "../domain/model";
import {
  attendanceRate,
  formatDate,
  isClosed,
  koreaDate,
  stateFor,
} from "../domain/rules";
import { getBundle, request } from "../api";
import { Badge, Empty, Notice, Spinner } from "../components/ui";
export function Student({ programId }: { programId: string }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(`student:${programId}`) || "null",
      );
    } catch {
      return null;
    }
  });
  const [bundle, setBundle] = useState<Bundle>();
  const [last4, setLast4] = useState("");
  const [name, setName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  async function load() {
    if (!session) return;
    try {
      const b = await getBundle(programId, session.token);
      setBundle(b);
      setDate(
        (v) =>
          v ||
          b.program.dates.find((d) => d >= koreaDate(new Date(b.serverNow))) ||
          b.program.dates.at(-1) ||
          "",
      );
    } catch (e) {
      setError((e as Error).message);
      setSession(null);
      sessionStorage.removeItem(`student:${programId}`);
    }
  }
  useEffect(() => {
    load();
  }, [session?.token]);
  async function signin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const s = await request<Session & { needsName?: boolean }>(
        "studentLogin",
        { programId, last4, name: needsName ? name : undefined },
        "",
      );
      if (s.needsName) setNeedsName(true);
      else {
        setSession(s);
        sessionStorage.setItem(`student:${programId}`, JSON.stringify(s));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function report(period: Period, absent: boolean) {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "report",
        { programId, date, period, absent },
        session.token,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <div className="student-login panel">
        <div className="large-icon">
          <CalendarDays size={27} />
        </div>
        <h2>내 출결을 확인하세요</h2>
        <p className="muted">등록한 휴대폰 번호 뒤 4자리로 조회할 수 있어요.</p>
        <form onSubmit={signin}>
          {error && <Notice error>{error}</Notice>}
          {needsName ? (
            <>
              <Notice>같은 번호가 있습니다. 이름을 입력해주세요.</Notice>
              <label className="field">
                이름
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  autoComplete="name"
                />
              </label>
              <button
                type="button"
                className="btn text"
                onClick={() => {
                  setNeedsName(false);
                  setName("");
                }}
              >
                번호 다시 입력
              </button>
            </>
          ) : (
            <label className="field">
              휴대폰 뒤 4자리
              <input
                value={last4}
                onChange={(e) =>
                  setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="0000"
                autoComplete="off"
              />
            </label>
          )}
          <button
            className="btn primary full"
            disabled={busy || (!needsName && last4.length !== 4)}
          >
            {busy ? "조회 중…" : "내 출결 조회"}
            <ArrowRight size={17} />
          </button>
        </form>
        <small className="muted">5회 실패하면 15분 동안 조회가 제한돼요.</small>
      </div>
    );
  if (!bundle) return <Spinner />;
  const person = bundle.participants[0];
  const rate = attendanceRate(bundle, person.id);
  return (
    <>
      <div className="section-line">
        <div>
          <h2>{person.name}님, 안녕하세요</h2>
          <p className="muted">내 출결과 결석 신고를 한눈에 확인하세요.</p>
        </div>
        <button
          className="btn secondary compact"
          onClick={async () => {
            await request("logout", {}, session.token).catch(() => {});
            sessionStorage.removeItem(`student:${programId}`);
            setSession(null);
            setBundle(undefined);
          }}
        >
          <LogOut size={15} />
          나가기
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="stats three">
        <div className="stat">
          <span>본인 서명</span>
          <strong>
            {rate.signed}
            <small> / {rate.total}회</small>
          </strong>
        </div>
        <div className="stat">
          <span>서명 기준 출석률</span>
          <strong>{rate.rate === null ? "집계 전" : `${rate.rate}%`}</strong>
        </div>
        <div className="stat">
          <span>마감 안내</span>
          <strong className="time-stat">
            {bundle.program.signatureEnabled
              ? "오전 13시 · 오후 18시"
              : "서명 18시"}
          </strong>
        </div>
      </div>
      {!bundle.program.dates.length ? (
        <Empty
          title="교육일을 준비하고 있어요"
          description="관리자가 교육일을 등록하면 출결을 확인할 수 있어요."
        />
      ) : (
        <>
          <section className="panel">
            <div className="section-line">
              <div>
                <h3>결석 신고</h3>
                <p className="muted small">
                  참석이 어려운 교육일을 미리 알려주세요.
                </p>
              </div>
              <select
                aria-label="결석 신고 날짜"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              >
                {bundle.program.dates.map((d) => (
                  <option key={d} value={d}>
                    {formatDate(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="report-grid">
              {programPeriods(bundle.program).map((period) => {
                const closed = isClosed(
                  date,
                  period,
                  new Date(bundle.serverNow),
                );
                const signed = bundle.signatures.some(
                  (s) => s.date === date && s.period === period,
                );
                const absent = bundle.absences.some(
                  (a) => a.date === date && a.period === period && a.absent,
                );
                return (
                  <div className="report-card" key={period}>
                    <strong>{PERIOD_LABEL[period]}</strong>
                    <Badge color={closed ? "gray" : "blue"}>
                      {signed
                        ? "서명 완료"
                        : closed
                          ? "마감"
                          : absent
                            ? "결석 신고됨"
                            : "출석 예정"}
                    </Badge>
                    <button
                      className={`btn ${absent ? "secondary" : "soft"} full`}
                      disabled={busy || closed || signed}
                      onClick={() => report(period, !absent)}
                    >
                      {closed
                        ? "신고 마감"
                        : absent
                          ? "결석 신고 취소"
                          : "결석 신고"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel">
            <h3>날짜별 출결</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>교육일</th>
                    {programPeriods(bundle.program).map((p) => (
                      <th key={p}>{PERIOD_LABEL[p]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bundle.program.dates.map((d) => (
                    <tr key={d}>
                      <td>{formatDate(d)}</td>
                      {programPeriods(bundle.program).map((p) => (
                        <td key={p}>
                          <Badge
                            color={
                              stateFor(bundle, person.id, d, p) === "서명 완료"
                                ? "green"
                                : "gray"
                            }
                          >
                            {stateFor(bundle, person.id, d, p)}
                          </Badge>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              출석률은 마감된 교육일의 본인 서명만 집계해요. 강사 판단은
              반영하지 않아요.
            </p>
          </section>
        </>
      )}
    </>
  );
}
