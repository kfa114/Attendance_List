import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Trash2,
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileSpreadsheet,
  FolderOpen,
  HelpCircle,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  CalendarDays,
  PenLine,
  LoaderCircle,
} from "lucide-react";
import type { ProgramSummary, Program, Role } from "./domain/model";
import { bootstrap, isGas, login, request } from "./api";
import { Badge, Empty, Modal, Notice, Spinner } from "./components/ui";
import { ProgramEditor } from "./features/ProgramEditor";
import { ProgramPage } from "./features/ProgramPage";
function route(hash = location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    programId: params.get("program") || "",
    role: (["student", "tablet", "admin"].includes(params.get("role") || "")
      ? params.get("role")
      : "admin") as Role,
    scopedToken: params.get("token") || "",
  };
}
export default function App() {
  const [token, setToken] = useState(
    sessionStorage.getItem("roster-admin") || "",
  );
  const [path, setPath] = useState(() => route());
  const [routeReady, setRouteReady] = useState(!isGas());
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [layout, setLayout] = useState("grid");
  const [sort, setSort] = useState("new");
  const [editor, setEditor] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState("");
  const [help, setHelp] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProgramSummary>();
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const toast = useCallback((text: string) => setNotification(text), []);
  useEffect(() => {
    if (notification) {
      const id = setTimeout(() => setNotification(""), 4000);
      return () => clearTimeout(id);
    }
  }, [notification]);
  useEffect(() => {
    const fn = () => setPath(route());
    if (isGas() && window.google?.script.url) {
      window.google.script.url.getLocation((loc) => {
        setPath(route(loc.hash));
        setRouteReady(true);
      });
      window.google.script.history?.setChangeHandler((e) =>
        setPath(route(e.location?.hash || "")),
      );
      return;
    }
    window.addEventListener("hashchange", fn);
    setRouteReady(true);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await bootstrap();
      setPrograms(data.programs);
    } catch (e) {
      if ((e as any).code === "AUTH") {
        sessionStorage.removeItem("roster-admin");
        setToken("");
      }
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load, path.programId]);
  function navigate(hash: string) {
    if (isGas()) window.google?.script.history?.push({ hash }, {}, hash);
    else location.hash = hash;
    setPath(route(hash));
  }
  function open(p: Program) {
    navigate(`program=${encodeURIComponent(p.id)}&role=admin`);
  }
  function home() {
    navigate("");
  }
  async function logout() {
    await request("logout").catch(() => {});
    sessionStorage.removeItem("roster-admin");
    setToken("");
    setPrograms([]);
    home();
  }
  async function changeStatus(p: ProgramSummary, status: Program["status"]) {
    if (statusBusy) return;
    setStatusBusy(true);
    setStatusError("");
    setError("");
    try {
      const updated = await request<Program>("setProgramStatus", {
        programId: p.id,
        revision: p.revision,
        status,
      });
      setPrograms((rows) =>
        rows.map((r) => (r.id === p.id ? { ...r, ...updated } : r)),
      );
      setDeleteTarget(undefined);
      toast(
        status === "deleted"
          ? "휴지통으로 옮겼습니다. 휴지통에서 복원할 수 있어요."
          : status === "archived"
            ? "프로그램을 보관했습니다."
            : "운영 중 목록으로 옮겼습니다.",
      );
    } catch (e) {
      const message = (e as Error).message;
      if (deleteTarget) setStatusError(message);
      else setError(message);
      if ((e as any).code === "CONFLICT") await load();
    } finally {
      setStatusBusy(false);
    }
  }
  const listed = programs.filter((p) => p.status !== "deleted");
  const active = programs.filter((p) => p.status === "active");
  const visible = programs
    .filter(
      (p) =>
        p.title.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" ? p.status !== "deleted" : p.status === filter),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, "ko")
        : b.createdAt.localeCompare(a.createdAt),
    );
  const totalPeople = listed.reduce((sum, p) => sum + p.participantCount, 0);
  const loginRequired =
    !token && (!path.programId || (path.role === "admin" && !path.scopedToken));
  return (
    <div className={`app ${!token ? "guest-app" : ""}`}>
      {token && (
        <aside className="sidebar">
          <button className="brand" onClick={home}>
            <span className="brand-mark">
              <Check size={25} strokeWidth={3} />
            </span>
            <strong>
              출석<span>CHULSEOK</span>
            </strong>
          </button>
          <div className="workspace-label">워크스페이스</div>
          <button
            className={`nav-item ${!path.programId ? "selected" : ""}`}
            onClick={home}
          >
            <LayoutGrid size={19} />
            <span>명단 관리</span>
            <span className="nav-count">{listed.length}</span>
          </button>
          <div className="sidebar-spacer" />
          <div className="sidebar-guide">
            <div className="guide-icon">
              <ShieldCheck size={20} />
            </div>
            <strong>명단부터 출결까지</strong>
            <p>
              프로그램마다 필요한 만큼,
              <br />
              간편하게 관리하세요.
            </p>
            <button onClick={() => setHelp(true)}>
              사용 방법 보기
              <ArrowRight size={14} />
            </button>
          </div>
          <button className="sidebar-user" onClick={logout} title="로그아웃">
            <div className="avatar">관</div>
            <div>
              <strong>관리자</strong>
              <span>워크스페이스 관리</span>
            </div>
            <LogOut size={17} />
          </button>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          {!token && (
            <button className="brand compact-brand" onClick={home}>
              <span className="brand-mark">
                <Check size={21} />
              </span>
              <strong>출석</strong>
            </button>
          )}
          <div className="breadcrumb">
            워크스페이스 <span>/</span>{" "}
            <strong>{path.programId ? "프로그램" : "명단 관리"}</strong>
          </div>
          <div className="topbar-right">
            {!isGas() && (
              <span className="local-indicator">
                <i />
                로컬 미리보기
              </span>
            )}
            <button
              className="icon-btn"
              onClick={() => setHelp(true)}
              aria-label="사용 방법"
            >
              <HelpCircle size={20} />
            </button>
            {token && <span className="avatar top-avatar">관</span>}
          </div>
        </header>
        <main className="main-content">
          {!routeReady ? (
            <Spinner />
          ) : loginRequired ? (
            <Login
              onLogin={(s) => {
                sessionStorage.setItem("roster-admin", s);
                setToken(s);
              }}
              error={error}
            />
          ) : path.programId ? (
            <ProgramPage
              key={path.programId}
              programId={path.programId}
              adminToken={token}
              scopedToken={path.scopedToken}
              initialRole={path.role}
              back={home}
              toast={toast}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">YOUR PROGRAMS, ALL IN ONE PLACE</div>
                  <h1>프로그램 명단</h1>
                  <p>새로운 만남의 시작부터 출석까지, 한곳에서 관리하세요.</p>
                </div>
                <button
                  className="btn primary create-btn"
                  onClick={() => setEditor(true)}
                >
                  <Plus size={18} />새 명단 만들기
                </button>
              </section>
              <section className="welcome-banner">
                <div className="welcome-copy">
                  <span className="banner-kicker">
                    <Sparkles size={14} />더 가벼운 프로그램 관리
                  </span>
                  <h2>
                    명단을 만들고,
                    <br className="mobile-only" /> 바로 시작하세요.
                  </h2>
                  <p>
                    직접 입력하거나 엑셀 파일을 가져오세요.
                    <br />
                    오전·오후 서명은 필요할 때만 켤 수 있어요.
                  </p>
                  <button onClick={() => setEditor(true)}>
                    첫 단계, 명단 만들기
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-orbit orbit1" />
                  <div className="art-orbit orbit2" />
                  <div className="art-sheet sheet-back" />
                  <div className="art-sheet">
                    <div className="art-sheet-header">
                      <ClipboardCheck size={21} />
                      <span>PROGRAM LIST</span>
                      <i />
                    </div>
                    <div className="art-line long" />
                    <div className="art-line" />
                    {[1, 2, 3].map((i) => (
                      <div className="art-person" key={i}>
                        <span>
                          <Check size={12} />
                        </span>
                        <i />
                        <i />
                      </div>
                    ))}
                  </div>
                  <div className="art-float">
                    <span>
                      <Check size={17} />
                    </span>
                    <div>
                      차곡차곡, 한눈에<strong>우리 프로그램 명단</strong>
                    </div>
                  </div>
                </div>
              </section>
              <section className="overview-stats">
                <div>
                  <span className="stat-icon blue">
                    <FolderOpen size={21} />
                  </span>
                  <div>
                    <span>전체 프로그램</span>
                    <strong>
                      {listed.length}
                      <small>개</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon teal">
                    <Users size={21} />
                  </span>
                  <div>
                    <span>등록된 참여자</span>
                    <strong>
                      {totalPeople}
                      <small>명</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon violet">
                    <PenLine size={21} />
                  </span>
                  <div>
                    <span>오전·오후 구분 프로그램</span>
                    <strong>
                      {active.filter((p) => p.signatureEnabled).length}
                      <small>개</small>
                    </strong>
                  </div>
                </div>
              </section>
              <section className="program-list">
                <div className="section-line list-title">
                  <h2>
                    내 프로그램 <span className="count">{listed.length}</span>
                  </h2>
                  <span className="small muted">
                    프로그램을 선택해 명단과 출결을 관리하세요.
                  </span>
                </div>
                <div className="list-toolbar">
                  <div className="filter-tabs">
                    <button
                      className={filter === "all" ? "active" : ""}
                      onClick={() => setFilter("all")}
                    >
                      전체 <span>{listed.length}</span>
                    </button>
                    <button
                      className={filter === "active" ? "active" : ""}
                      onClick={() => setFilter("active")}
                    >
                      운영 중 <span>{active.length}</span>
                    </button>
                    <button
                      className={filter === "archived" ? "active" : ""}
                      onClick={() => setFilter("archived")}
                    >
                      보관
                    </button>
                    <button
                      className={filter === "deleted" ? "active" : ""}
                      onClick={() => setFilter("deleted")}
                    >
                      휴지통
                    </button>
                  </div>
                  <div className="toolbar-controls">
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="프로그램 검색"
                        placeholder="프로그램명 검색"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="프로그램 정렬"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="new">최신순</option>
                      <option value="name">이름순</option>
                    </select>
                    <div className="view-toggle">
                      <button
                        className={layout === "grid" ? "active" : ""}
                        onClick={() => setLayout("grid")}
                        aria-label="카드 보기"
                      >
                        <LayoutGrid size={17} />
                      </button>
                      <button
                        className={layout === "list" ? "active" : ""}
                        onClick={() => setLayout("list")}
                        aria-label="목록 보기"
                      >
                        <List size={18} />
                      </button>
                    </div>
                  </div>
                </div>
                {error && <Notice error>{error}</Notice>}
                {loading ? (
                  <Spinner />
                ) : !visible.length ? (
                  <Empty
                    title={
                      query || filter !== "all"
                        ? "조건에 맞는 프로그램이 없어요"
                        : "아직 등록된 프로그램이 없어요"
                    }
                    description={
                      query || filter !== "all"
                        ? "다른 검색어나 필터를 선택해주세요."
                        : "첫 명단을 만들면 이곳에 프로그램이 모여요."
                    }
                    action={
                      query || filter !== "all"
                        ? undefined
                        : () => setEditor(true)
                    }
                  />
                ) : (
                  <div
                    className={`program-grid ${layout === "list" ? "program-grid-list" : ""}`}
                  >
                    {visible.map((p) => (
                      <article className="program-item" key={p.id}>
                        <button
                          className="program-card"
                          aria-label={`${p.title} 명단 열기`}
                          disabled={p.status === "deleted"}
                          onClick={() => open(p)}
                        >
                          <div className="card-top">
                            <span
                              className={`program-icon ${p.signatureEnabled ? "" : "neutral"}`}
                            >
                              {p.signatureEnabled ? (
                                <ClipboardCheck size={25} strokeWidth={1.7} />
                              ) : (
                                <Users size={25} strokeWidth={1.7} />
                              )}
                            </span>
                            <Badge
                              color={p.status === "active" ? "green" : "gray"}
                            >
                              {p.status === "active"
                                ? "운영 중"
                                : p.status === "deleted"
                                  ? "휴지통"
                                  : "보관"}
                            </Badge>
                          </div>
                          <div className="card-body">
                            <h3>{p.title}</h3>
                            <span className="card-subtitle">
                              {p.signatureEnabled
                                ? "오전·오후 서명 사용"
                                : "기본 서명 사용"}
                            </span>
                            <div className="card-meta">
                              <span>
                                <Users size={15} />
                                {p.participantCount}명
                              </span>
                              <span>
                                <CalendarDays size={15} />
                                {p.dates.length
                                  ? `교육일 ${p.dates.length}일`
                                  : "교육일 미설정"}
                              </span>
                            </div>
                          </div>
                          <div className="card-bottom">
                            <span>
                              {new Date(p.createdAt).toLocaleDateString(
                                "ko-KR",
                                {
                                  timeZone: "Asia/Seoul",
                                },
                              )}{" "}
                              생성
                            </span>
                            <span>
                              명단 열기
                              <ArrowRight size={15} />
                            </span>
                          </div>
                        </button>
                        <div
                          className="program-actions"
                          aria-label={`${p.title} 관리`}
                        >
                          <button
                            className="btn secondary compact"
                            disabled={statusBusy}
                            aria-label={`${p.title} ${p.status === "active" ? "보관" : p.status === "deleted" ? "복원" : "운영 재개"}`}
                            onClick={() =>
                              changeStatus(
                                p,
                                p.status === "active" ? "archived" : "active",
                              )
                            }
                          >
                            {p.status === "active" ? (
                              <Archive size={16} />
                            ) : (
                              <ArchiveRestore size={16} />
                            )}
                            {p.status === "active"
                              ? "보관"
                              : p.status === "deleted"
                                ? "복원"
                                : "운영 재개"}
                          </button>
                          {p.status !== "deleted" && (
                            <button
                              className="btn secondary compact danger-text"
                              disabled={statusBusy}
                              aria-label={`${p.title} 삭제`}
                              onClick={() => {
                                setStatusError("");
                                setDeleteTarget(p);
                              }}
                            >
                              <Trash2 size={16} /> 삭제
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    <button
                      className="new-program-card"
                      onClick={() => setEditor(true)}
                    >
                      <span>
                        <Plus size={23} />
                      </span>
                      <strong>새 프로그램 시작하기</strong>
                      <small>새로운 명단을 만들어보세요.</small>
                    </button>
                  </div>
                )}
              </section>
              <footer className="page-footer">
                <ShieldCheck size={14} />
                프로그램별 명단과 기록은 독립적으로 관리돼요.
                <span>출석 · 프로그램 명단 관리</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {editor && (
        <ProgramEditor
          close={() => setEditor(false)}
          saved={(p) => {
            setEditor(false);
            load();
            toast("새 명단을 만들었습니다.");
            open(p);
          }}
        />
      )}
      {deleteTarget && (
        <Modal
          title="프로그램을 삭제할까요?"
          close={() => {
            if (!statusBusy) setDeleteTarget(undefined);
          }}
        >
          <div className="modal-body">
            {statusError && <Notice error>{statusError}</Notice>}
            <h3>{deleteTarget.title}</h3>
            <p>
              참여자 {deleteTarget.participantCount}명의 프로그램을 목록에서
              삭제하고 휴지통으로 옮깁니다.
            </p>
            <Notice>
              명단과 서명·출결 기록은 보존되며 휴지통에서 복원할 수 있어요.
              휴지통에 있는 동안 교육생·태블릿 링크로 접근할 수 없습니다.
            </Notice>
          </div>
          <div className="modal-footer">
            <button
              className="btn secondary"
              disabled={statusBusy}
              onClick={() => setDeleteTarget(undefined)}
            >
              취소
            </button>
            <button
              className="btn primary"
              disabled={statusBusy}
              onClick={() => changeStatus(deleteTarget, "deleted")}
            >
              <Trash2 size={16} />
              {statusBusy ? "삭제 중…" : "휴지통으로 이동"}
            </button>
          </div>
        </Modal>
      )}
      {notification && (
        <div className="toast" role="status">
          <Check size={17} />
          {notification}
          <button
            className="icon-btn"
            onClick={() => setNotification("")}
            aria-label="알림 닫기"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="출석, 이렇게 시작하세요" close={() => setHelp(false)}>
          <div className="modal-body help-body">
            <div>
              <span>01</span>
              <div>
                <h3>프로그램 명단 만들기</h3>
                <p>
                  프로그램명과 참여자를 직접 입력하거나 엑셀·CSV·ODS 파일을
                  가져오세요.
                </p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <h3>필요한 기능만 켜기</h3>
                <p>
                  기본 서명 또는 오전·오후 서명을 선택하고 교육일을 등록하세요.
                </p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <h3>역할별로 간편하게</h3>
                <p>
                  교육생은 내 출결 조회, 현장 태블릿은 서명, 강사는 미서명자의
                  출결을 판단해요.
                </p>
              </div>
            </div>
            <Notice>
              오전 13시 · 오후 18시 마감. 출석률은 마감된 교육일의 본인 서명만
              반영해요.
            </Notice>
            {!isGas() && (
              <p className="small muted">
                로컬 미리보기는 이 컴퓨터의 .local 파일에 저장돼요. Google
                저장·기기 간 공유·PDF 생성은 Apps Script 배포 후 사용할 수
                있어요.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Login({
  onLogin,
  error: initialError,
}: {
  onLogin: (token: string) => void;
  error: string;
}) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await login(secret);
      onLogin(s.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="login-wrap">
      <div className="login-copy">
        <span className="eyebrow">A LITTLE MORE ORGANIZED</span>
        <h1>
          모든 프로그램,
          <br />
          한곳에서 차곡차곡.
        </h1>
        <p>
          명단을 만들고, 서명을 받고, 출결을 확인하세요.
          <br />
          복잡한 준비 없이 시작하는 프로그램 관리.
        </p>
        <div className="login-benefits">
          <span>
            <FileSpreadsheet size={20} />
            엑셀 파일로 간편하게
          </span>
          <span>
            <Users size={20} />
            여러 프로그램을 한눈에
          </span>
          <span>
            <ShieldCheck size={20} />
            역할별로 필요한 기능만
          </span>
        </div>
      </div>
      <div className="login-card">
        <div className="large-icon">
          <LockKeyhole size={25} />
        </div>
        <h2>관리자 로그인</h2>
        <p className="muted">명단을 만들고 관리하려면 로그인해주세요.</p>
        <form onSubmit={submit}>
          {error && <Notice error>{error}</Notice>}
          <label className="field">
            관리자 암호
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="관리자 암호를 입력해주세요"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            {busy ? "로그인 중…" : "워크스페이스 열기"}
            <ArrowRight size={17} />
          </button>
        </form>
        {!isGas() && (
          <div className="local-login">
            <strong>로컬 개발 미리보기</strong>
            <p>실제 Google 데이터에 연결되지 않아요.</p>
            <button
              className="btn soft full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const s = await login("local-preview-admin");
                  onLogin(s.token);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              미리보기 시작
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
