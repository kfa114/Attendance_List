import { trashDeadline } from "../src/domain/trash";
import { programPeriods } from "../src/domain/model";
import type { Repository, Runtime } from "./ports";
import {
  AppError,
  assertPeriod,
  canSign,
  isClosed,
  koreaDate,
  LIMITS,
  stateFor,
  validateProgram,
} from "../src/domain/rules";
import type {
  Absence,
  ApiRequest,
  ApiResponse,
  Audit,
  Bundle,
  Contact,
  Decision,
  ExportRecord,
  Participant,
  Program,
  Session,
  Signature,
} from "../src/domain/model";
export class Service {
  constructor(
    private db: Repository,
    private rt: Runtime,
  ) {}
  handle(req: ApiRequest): ApiResponse {
    try {
      return { ok: true, data: this.dispatch(req) };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof AppError
            ? e.message
            : "처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
        code: e instanceof AppError ? e.code : "SERVER",
      };
    }
  }
  private auth(token?: string, kind?: Session["kind"]): Session {
    const s = token ? this.rt.session(token) : null;
    if (
      !s ||
      s.expiresAt <= this.rt.now().getTime() ||
      (kind && s.kind !== kind)
    )
      throw new AppError("로그인이 필요합니다. 다시 로그인해주세요.", "AUTH");
    return s;
  }
  private program(id: string, includeDeleted = false): Program {
    const p = this.db.list<Program>("programs").find((p) => p.id === id);
    if (
      !p ||
      (!includeDeleted && p.status === "deleted") ||
      (trashDeadline(p) !== undefined &&
        trashDeadline(p)! <= this.rt.now().getTime())
    )
      throw new AppError("명단을 찾을 수 없습니다.", "NOT_FOUND");
    return p;
  }
  private enabled(p: Program) {
    if (p.status !== "active")
      throw new AppError("보관된 프로그램은 조회만 가능합니다.");
  }
  private scoped(s: Session, id: string) {
    if (s.kind !== "admin" && s.programId !== id)
      throw new AppError("접근할 수 없는 프로그램입니다.", "FORBIDDEN");
  }
  private issue(kind: Session["kind"], fields: Partial<Session> = {}): Session {
    const s: Session = {
      token: this.rt.id() + this.rt.id(),
      kind,
      expiresAt:
        this.rt.now().getTime() + (kind === "tablet" ? 6 : 4) * 3600_000,
      by:
        kind === "admin"
          ? "관리자"
          : kind === "tablet"
            ? "현장 태블릿"
            : "교육생",
      ...fields,
    };
    this.rt.saveSession(s);
    return s;
  }
  private signatures(programId: string): Signature[] {
    return this.db
      .list<Signature>("signatures", programId)
      .filter((s) => !s.canceledAt);
  }
  private savedSignature(
    programId: string,
    participantId: string,
    date: string,
  ) {
    return this.signatures(programId)
      .filter(
        (s) =>
          s.participantId === participantId &&
          s.date < date &&
          !s.sourceSignatureId,
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.signedAt.localeCompare(a.signedAt),
      )[0];
  }
  private signingAccess(session: Session, data: any) {
    this.scoped(session, data.programId);
    if (!["admin", "tablet", "signing"].includes(session.kind))
      throw new AppError("현장 서명 화면을 이용해주세요.", "FORBIDDEN");
    if (
      session.kind === "signing" &&
      (session.date !== data.date || session.period !== data.period)
    )
      throw new AppError(
        "QR에 지정된 교육일과 서명 시간만 사용할 수 있습니다.",
        "FORBIDDEN",
      );
    const p = this.program(data.programId);
    this.enabled(p);
    this.validSlot(p, data);
    this.participant(p.id, data.participantId);
    return p;
  }
  private bundle(id: string): Bundle {
    return {
      program: this.program(id),
      participants: this.db.list("participants", id),
      signatures: this.signatures(id),
      absences: this.db.list("absences", id),
      decisions: this.db.list("decisions", id),
      contacts: this.db.list("contacts", id),
      audits: this.db.list<Audit>("audits", id).slice(-100).reverse(),
      exports: this.db.list("exports", id),
      serverNow: this.rt.now().toISOString(),
    };
  }
  private audit(id: string, action: string, by: string) {
    this.db.put("audits", {
      id: this.rt.id(),
      programId: id,
      action,
      by,
      at: this.rt.now().toISOString(),
    });
  }
  private validSlot(p: Program, d: any) {
    assertPeriod(d.period);
    if (!programPeriods(p).includes(d.period))
      throw new AppError(
        "프로그램의 현재 서명 방식과 다릅니다. 새로고침해주세요.",
      );
    if (!p.dates.includes(d.date))
      throw new AppError("등록되지 않은 교육일입니다.");
  }
  private participant(pid: string, id: string): Participant {
    const row = this.db
      .list<Participant>("participants", pid)
      .find((r) => r.id === id);
    if (!row) throw new AppError("참여자를 찾을 수 없습니다.");
    return row;
  }
  private dispatch(req: ApiRequest): any {
    const d = req.data || {};
    if (req.action === "login") {
      this.rt.throttle("admin");
      if (!this.rt.adminLogin(String(d.secret || "")))
        throw new AppError("관리자 암호를 확인해주세요.", "LOGIN");
      this.rt.clearThrottle("admin");
      return this.issue("admin");
    }
    if (req.action === "publicProgram") {
      const p = this.program(d.programId);
      return {
        id: p.id,
        title: p.title,
        signatureEnabled: p.signatureEnabled,
        status: p.status,
      };
    }
    if (req.action === "studentLogin") {
      const p = this.program(d.programId);
      this.enabled(p);
      const last4 = String(d.last4 || "");
      if (!/^\d{4}$/.test(last4))
        throw new AppError("휴대폰 뒤 4자리를 입력해주세요.");
      const key = `student:${p.id}:${last4}`;
      this.rt.throttle(key);
      let matches = this.db
        .list<Participant>("participants", p.id)
        .filter((r) => r.phone.endsWith(last4));
      if (matches.length > 1 && !d.name && !d.participantId)
        return {
          needsName: true,
          candidates: matches.map(({ id, name, order }) => ({
            id,
            name,
            order,
          })),
        };
      if (d.participantId)
        matches = matches.filter((r) => r.id === d.participantId);
      else if (d.name)
        matches = matches.filter((r) => r.name === String(d.name).trim());
      if (matches.length !== 1)
        throw new AppError(
          "입력 정보를 확인해주세요. 이름까지 같은 경우 관리자에게 문의해주세요.",
          "LOGIN",
        );
      this.rt.clearThrottle(key);
      return this.issue("student", {
        programId: p.id,
        participantId: matches[0].id,
        by: "교육생",
      });
    }
    const session = this.auth(req.token);
    if (req.action === "getImporter") {
      this.auth(req.token, "admin");
      return this.rt.importer();
    }
    if (req.action === "logout") {
      this.rt.deleteSession(session.token);
      return true;
    }
    if (req.action === "bootstrap") {
      this.auth(req.token, "admin");
      return {
        programs: this.db
          .list<Program>("programs")
          .filter(
            (p) =>
              trashDeadline(p) === undefined ||
              trashDeadline(p)! > this.rt.now().getTime(),
          )
          .map((p) => ({
            ...p,
            participantCount: this.db.list<Participant>("participants", p.id)
              .length,
          })),
        serverNow: this.rt.now().toISOString(),
        mode: this.rt.platform?.() || (this.rt.appUrl() ? "gas" : "local"),
      };
    }
    if (req.action === "createProgram") {
      this.auth(req.token, "admin");
      const input = validateProgram(d);
      return this.db.lock(() => {
        const p: Program = {
          id: this.rt.id(),
          title: input.title,
          signatureEnabled: input.signatureEnabled,
          status: "active",
          dates: input.dates,
          revision: 1,
          disabledIntervals: [],
          createdAt: this.rt.now().toISOString(),
          updatedAt: this.rt.now().toISOString(),
        };
        const rows = input.participants.map((r, index) => ({
          ...r,
          id: this.rt.id(),
          programId: p.id,
          order: index + 1,
        }));
        try {
          this.db.putMany("participants", rows);
          this.db.put("programs", p);
        } catch (e) {
          rows.forEach((r) => this.db.remove("participants", r.id));
          throw e;
        }
        this.audit(p.id, "명단 생성", session.by);
        return p;
      });
    }
    if (req.action === "getBundle") {
      if (session.kind === "signing")
        throw new AppError("휴대폰 서명 화면을 이용해주세요.", "FORBIDDEN");
      this.scoped(session, d.programId);
      const b = this.bundle(d.programId);
      if (session.kind === "admin") return b;
      this.enabled(b.program);
      if (session.kind === "student")
        return {
          ...b,
          participants: b.participants
            .filter((r) => r.id === session.participantId)
            .map((r) => ({ ...r, phone: "", note: "" })),
          signatures: b.signatures
            .filter((r) => r.participantId === session.participantId)
            .map((r) => ({ ...r, fileId: "" })),
          absences: b.absences.filter(
            (r) => r.participantId === session.participantId,
          ),
          decisions: b.decisions.filter(
            (r) => r.participantId === session.participantId,
          ),
          contacts: [],
          audits: [],
          exports: [],
        };
      return {
        ...b,
        participants: b.participants.map((r) => ({
          ...r,
          phone: "",
          note: "",
        })),
        signatures: b.signatures.map((r) => ({
          ...r,
          fileId: "",
          signedAt: "",
          requestId: "",
        })),
        absences: [],
        decisions: [],
        contacts: [],
        audits: [],
        exports: [],
      };
    }
    if (req.action === "setProgramStatus") {
      this.auth(req.token, "admin");
      return this.db.lock(() => {
        const p = this.program(d.programId, true);
        if (!["active", "archived", "deleted"].includes(d.status))
          throw new AppError("변경할 상태를 확인해주세요.");
        if (p.revision !== d.revision)
          throw new AppError(
            "다른 화면에서 변경됐습니다. 목록을 새로고침 후 다시 시도해주세요.",
            "CONFLICT",
          );
        const updated: Program = {
          ...p,
          status: d.status,
          deletedAt:
            d.status === "deleted"
              ? p.status === "deleted"
                ? p.deletedAt || p.updatedAt
                : this.rt.now().toISOString()
              : undefined,
          revision: p.revision + 1,
          updatedAt: this.rt.now().toISOString(),
        };
        this.db.put("programs", updated);
        this.audit(
          p.id,
          d.status === "deleted"
            ? "프로그램 휴지통 이동"
            : d.status === "archived"
              ? "프로그램 보관"
              : p.status === "deleted"
                ? "프로그램 복원"
                : "프로그램 운영 재개",
          session.by,
        );
        return updated;
      });
    }
    if (req.action === "updateProgram") {
      this.auth(req.token, "admin");
      return this.db.lock(() => {
        const p = this.program(d.programId);
        if (p.revision !== d.revision)
          throw new AppError(
            "다른 화면에서 수정됐습니다. 새로고침 후 다시 저장해주세요.",
            "CONFLICT",
          );
        const input = validateProgram(d);
        const b = this.bundle(p.id);
        const usedDates = new Set(
          [
            ...this.db.list<Signature>("signatures", p.id),
            ...b.absences,
            ...b.decisions,
          ].map((r) => r.date),
        );
        if ([...usedDates].some((date) => !input.dates.includes(date)))
          throw new AppError("기록이 있는 교육일은 제거할 수 없습니다.");
        const ids = Array.isArray(d.participantIds) ? d.participantIds : [];
        if (
          ids.length !== input.participants.length ||
          new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length ||
          ids.some(
            (id: string) => id && !b.participants.some((r) => r.id === id),
          )
        )
          throw new AppError("명단 연결 정보를 확인해주세요.");
        if (b.participants.some((r) => !ids.includes(r.id)))
          throw new AppError("저장된 참여자는 제거할 수 없습니다.");
        if (
          (this.db.list<Signature>("signatures", p.id).length ||
            b.decisions.length ||
            b.absences.length) &&
          ids.some((id: string) => !id)
        )
          throw new AppError(
            "운영 기록이 생성된 명단에는 참여자를 추가할 수 없습니다.",
          );
        this.db.putMany(
          "participants",
          input.participants.map((r, i) => ({
            ...r,
            id: ids[i] || this.rt.id(),
            programId: p.id,
            order: i + 1,
          })),
        );
        const updated = {
          ...p,
          disabledIntervals: [],
          title: input.title,
          signatureEnabled: input.signatureEnabled,
          dates: input.dates,
          status: d.status === "archived" ? "archived" : "active",
          updatedAt: this.rt.now().toISOString(),
          revision: p.revision + 1,
        };
        this.db.put("programs", updated);
        this.audit(p.id, "명단·프로그램 설정 변경", session.by);
        return updated;
      });
    }
    if (req.action === "tabletSession") {
      this.auth(req.token, "admin");
      this.enabled(this.program(d.programId));
      const s = this.issue("tablet", { programId: d.programId });
      return {
        ...s,
        url: `${this.rt.appUrl()}#program=${encodeURIComponent(d.programId)}&role=tablet&token=${s.token}`,
      };
    }
    if (req.action === "signingSession") {
      if (!["admin", "tablet"].includes(session.kind))
        throw new AppError("현장 기기에서 QR을 생성해주세요.", "FORBIDDEN");
      this.scoped(session, d.programId);
      const p = this.program(d.programId);
      this.enabled(p);
      this.validSlot(p, d);
      if (!canSign(d.date, d.period, this.rt.now()))
        throw new AppError(
          "오늘 교육일의 마감 전까지 QR을 생성할 수 있습니다.",
          "CLOSED",
        );
      const s = this.issue("signing", {
        programId: p.id,
        date: d.date,
        period: d.period,
        expiresAt: Math.min(
          session.expiresAt,
          this.rt.now().getTime() + 6 * 3600_000,
        ),
        by: "개인 휴대폰",
      });
      return {
        token: s.token,
        expiresAt: s.expiresAt,
        url: `${this.rt.appUrl()}#program=${encodeURIComponent(p.id)}&role=signing&token=${s.token}`,
      };
    }
    if (req.action === "signingRoster") {
      if (session.kind !== "signing")
        throw new AppError("현장의 QR을 다시 스캔해주세요.", "FORBIDDEN");
      this.scoped(session, d.programId);
      const p = this.program(d.programId);
      this.enabled(p);
      this.validSlot(p, session);
      const signatures = this.signatures(p.id);
      return {
        title: p.title,
        date: session.date,
        period: session.period,
        open: canSign(session.date!, session.period!, this.rt.now()),
        participants: this.db
          .list<Participant>("participants", p.id)
          .map(({ id, name, order }) => ({
            id,
            name,
            order,
            signed: signatures.some(
              (s) =>
                s.participantId === id &&
                s.date === session.date &&
                s.period === session.period,
            ),
          })),
      };
    }
    if (req.action === "cancelSignature") {
      this.auth(req.token, "admin");
      return this.db.lock(() => {
        const p = this.program(d.programId);
        this.enabled(p);
        this.validSlot(p, d);
        this.participant(p.id, d.participantId);
        const signature = this.db
          .list<Signature>("signatures", p.id)
          .find(
            (s) =>
              s.id === d.signatureId &&
              s.participantId === d.participantId &&
              s.date === d.date &&
              s.period === d.period,
          );
        if (!signature)
          throw new AppError(
            "취소할 서명을 찾을 수 없습니다. 새로고침해주세요.",
            "CONFLICT",
          );
        if (signature.canceledAt) return true;
        this.db.put("signatures", {
          ...signature,
          canceledAt: this.rt.now().toISOString(),
          canceledBy: session.by,
        });
        this.db.remove("decisions", `${d.participantId}_${d.date}_${d.period}`);
        const person = this.participant(p.id, d.participantId);
        this.audit(
          p.id,
          `${person.name} · ${d.date} · ${d.period} 서명 취소`,
          session.by,
        );
        return true;
      });
    }
    if (req.action === "savedSignature") {
      const p = this.signingAccess(session, d);
      if (!canSign(d.date, d.period, this.rt.now()))
        return { available: false };
      const source = this.savedSignature(p.id, d.participantId, d.date);
      return source
        ? { available: true, sourceId: source.id, date: source.date }
        : { available: false };
    }
    if (req.action === "savedSignaturePreview") {
      const p = this.signingAccess(session, d);
      if (!canSign(d.date, d.period, this.rt.now()))
        throw new AppError("서명이 마감됐습니다.", "CLOSED");
      const source = this.savedSignature(p.id, d.participantId, d.date);
      if (!source || source.id !== d.sourceId)
        throw new AppError(
          "저장된 서명이 변경되었거나 취소됐습니다.",
          "CONFLICT",
        );
      return { image: this.rt.image(source.fileId), sourceId: source.id };
    }
    if (req.action === "sign" || req.action === "reuseSignature") {
      return this.db.lock(() => {
        const p = this.signingAccess(session, d);
        const existing = this.signatures(p.id).find(
          (r) =>
            r.participantId === d.participantId &&
            r.date === d.date &&
            r.period === d.period,
        );
        if (existing) {
          if (existing.requestId === d.requestId) return { signed: true };
          throw new AppError("이미 서명한 교육생입니다.", "DUPLICATE");
        }
        if (!canSign(d.date, d.period, this.rt.now()))
          throw new AppError(
            "오늘 교육일의 마감 전까지 서명할 수 있습니다.",
            "CLOSED",
          );
        if (
          typeof d.requestId !== "string" ||
          !d.requestId ||
          d.requestId.length > 100
        )
          throw new AppError("서명 요청을 확인해주세요.");
        if (
          this.db
            .list<Signature>("signatures", p.id)
            .some(
              (s) =>
                s.canceledAt &&
                s.participantId === d.participantId &&
                s.date === d.date &&
                s.period === d.period &&
                s.requestId === d.requestId,
            )
        )
          throw new AppError(
            "취소된 서명 요청입니다. 화면을 닫고 다시 서명해주세요.",
            "CONFLICT",
          );
        let fileId: string;
        let sourceSignatureId: string | undefined;
        if (req.action === "reuseSignature") {
          const source = this.savedSignature(p.id, d.participantId, d.date);
          if (!source || source.id !== d.sourceId)
            throw new AppError(
              "저장된 서명이 변경되었거나 취소됐습니다. 직접 서명해주세요.",
              "CONFLICT",
            );
          fileId = source.fileId;
          sourceSignatureId = source.id;
        } else {
          if (
            typeof d.image !== "string" ||
            !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=\r\n]+$/.test(
              d.image,
            ) ||
            d.image.length > LIMITS.signatureBytes ||
            d.image.length < 150
          )
            throw new AppError("서명 이미지를 확인해주세요.");
          fileId = this.rt.putImage(
            d.image,
            `${p.id}_${d.participantId}_${d.date}_${d.period}.png`,
          );
        }
        try {
          if (!canSign(d.date, d.period, this.rt.now()))
            throw new AppError(
              "저장 중 마감됐습니다. 강사에게 문의해주세요.",
              "CLOSED",
            );
          this.db.put("signatures", {
            id: this.rt.id(),
            programId: p.id,
            participantId: d.participantId,
            date: d.date,
            period: d.period,
            fileId,
            signedAt: this.rt.now().toISOString(),
            requestId: d.requestId,
            ...(sourceSignatureId ? { sourceSignatureId } : {}),
          });
        } catch (e) {
          if (!sourceSignatureId) this.rt.removeFile(fileId);
          throw e;
        }
        const person = this.participant(p.id, d.participantId);
        this.audit(
          p.id,
          sourceSignatureId
            ? `${person.name} · ${d.date} · ${d.period} 저장된 서명 불러오기`
            : "본인 서명 저장",
          session.by,
        );
        return { signed: true };
      });
    }
    if (req.action === "report") {
      if (session.kind !== "student")
        throw new AppError("본인 조회 후 신고해주세요.", "FORBIDDEN");
      this.scoped(session, d.programId);
      return this.db.lock(() => {
        const p = this.program(d.programId);
        this.enabled(p);
        this.validSlot(p, d);
        if (isClosed(d.date, d.period, this.rt.now()))
          throw new AppError("마감되어 신고를 수정할 수 없습니다.", "CLOSED");
        if (typeof d.absent !== "boolean")
          throw new AppError("신고 내용을 확인해주세요.");
        if (
          this.signatures(p.id).some(
            (r) =>
              r.participantId === session.participantId &&
              r.date === d.date &&
              r.period === d.period,
          )
        )
          throw new AppError(
            "이미 서명한 출결은 결석 신고를 변경할 수 없습니다.",
          );
        const id = `${session.participantId}_${d.date}_${d.period}`;
        this.db.put("absences", {
          id,
          programId: p.id,
          participantId: session.participantId,
          date: d.date,
          period: d.period,
          absent: d.absent,
          updatedAt: this.rt.now().toISOString(),
        });
        this.audit(p.id, "결석 신고 변경", session.by);
        return true;
      });
    }
    if (req.action === "decide" || req.action === "contact") {
      this.auth(req.token, "admin");
      return this.db.lock(() => {
        const p = this.program(d.programId);
        this.enabled(p);
        this.validSlot(p, d);
        this.participant(p.id, d.participantId);
        if (d.date > koreaDate(this.rt.now()))
          throw new AppError("미래 교육일의 출결은 확정할 수 없습니다.");
        const id = `${d.participantId}_${d.date}_${d.period}`;
        if (req.action === "decide") {
          if (!["present", "absent"].includes(d.result))
            throw new AppError("출석 또는 결석을 선택해주세요.");
          if (
            this.signatures(p.id).some(
              (s) =>
                s.participantId === d.participantId &&
                s.date === d.date &&
                s.period === d.period,
            )
          )
            throw new AppError("본인 서명이 있는 출결은 변경할 수 없습니다.");
          this.db.put("decisions", {
            id,
            programId: p.id,
            participantId: d.participantId,
            date: d.date,
            period: d.period,
            result: d.result,
            by: session.by,
            updatedAt: this.rt.now().toISOString(),
          });
          this.audit(
            p.id,
            `미서명 ${d.result === "present" ? "출석" : "결석"} 판단`,
            session.by,
          );
        } else {
          if (
            !["", "오는 중", "결석 확인", "연락 안 됨", "연락 완료"].includes(
              d.result,
            ) ||
            typeof d.assignee !== "string" ||
            d.assignee.length > 40
          )
            throw new AppError("연락 기록을 확인해주세요.");
          this.db.put("contacts", {
            id,
            programId: p.id,
            participantId: d.participantId,
            date: d.date,
            period: d.period,
            assignee: d.assignee,
            result: d.result,
            updatedAt: this.rt.now().toISOString(),
          });
          this.audit(p.id, "연락 기록 변경", session.by);
        }
        return true;
      });
    }
    if (req.action === "createExport") {
      this.auth(req.token, "admin");
      return this.db.lock(() => {
        const b = this.bundle(d.programId);
        if (!b.program.dates.includes(d.date))
          throw new AppError("출력할 교육일을 선택해주세요.");
        const rows = b.participants.map((p) => {
          const am = b.signatures.find(
            (s) =>
              s.participantId === p.id &&
              s.date === d.date &&
              s.period === "am",
          );
          const pm = b.signatures.find(
            (s) =>
              s.participantId === p.id &&
              s.date === d.date &&
              s.period === "pm",
          );
          return {
            order: p.order,
            name: p.name,
            note: p.note,
            singleMode: !b.program.signatureEnabled,
            single:
              b.signatures.find(
                (s) =>
                  s.participantId === p.id &&
                  s.date === d.date &&
                  s.period === "single",
              )?.fileId || "",
            singleStatus: stateFor(b, p.id, d.date, "single"),
            am: am?.fileId || "",
            pm: pm?.fileId || "",
            amStatus: stateFor(b, p.id, d.date, "am"),
            pmStatus: stateFor(b, p.id, d.date, "pm"),
          };
        });
        const file = this.rt.createPdf(b.program.title, d.date, rows);
        const rec: ExportRecord = {
          id: this.rt.id(),
          programId: b.program.id,
          date: d.date,
          fileId: file.fileId,
          version: b.exports.filter((e) => e.date === d.date).length + 1,
          createdAt: this.rt.now().toISOString(),
        };
        this.db.put("exports", rec);
        this.audit(b.program.id, "출석부 PDF 버전 생성", session.by);
        return rec;
      });
    }
    if (req.action === "downloadExport") {
      this.auth(req.token, "admin");
      this.program(d.programId);
      const rec = this.db
        .list<ExportRecord>("exports", d.programId)
        .find((e) => e.id === d.exportId);
      if (!rec) throw new AppError("출력 버전을 찾을 수 없습니다.");
      return this.rt.pdf(rec.fileId);
    }
    throw new AppError("지원하지 않는 요청입니다.");
  }
}
