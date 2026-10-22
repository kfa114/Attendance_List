import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { request } from "../api";
import { Eraser, Check, LoaderCircle, Download } from "lucide-react";
import { Modal, Notice } from "./ui";
import { formatDate } from "../domain/rules";
import { PERIOD_LABEL, type Participant, type Period } from "../domain/model";
export function SignatureDialog({
  participant,
  date,
  period,
  close,
  save,
  saved,
}: {
  participant: Pick<Participant, "name">;
  date: string;
  period: Period;
  close: () => void;
  save: (image: string, requestId: string) => Promise<void>;
  saved?: {
    programId: string;
    participantId: string;
    token: string;
    complete: () => Promise<void> | void;
  };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState<{
    available: boolean;
    sourceId?: string;
    date?: string;
  }>();
  const [lookupError, setLookupError] = useState("");
  useEffect(() => {
    let active = true;
    setStored(undefined);
    setLookupError("");
    if (saved)
      request(
        "savedSignature",
        {
          programId: saved.programId,
          participantId: saved.participantId,
          date,
          period,
        },
        saved.token,
      )
        .then((result) => {
          if (active) setStored(result);
        })
        .catch(() => {
          if (active)
            setLookupError(
              "저장된 서명을 확인하지 못했습니다. 직접 서명해주세요.",
            );
        });
    return () => {
      active = false;
    };
  }, [saved?.programId, saved?.participantId, saved?.token, date, period]);
  const baseImage = useRef<
    { image: HTMLImageElement; sourceId: string } | undefined
  >(undefined);
  const redraw = useRef<() => void>(() => {});
  const generation = useRef(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [guideSize, setGuideSize] = useState(64);
  const locked = busy || loadingPreview;
  async function reuse() {
    if (!saved || !stored?.available || !stored.sourceId || locked) return;
    const current = ++generation.current;
    setLoadingPreview(true);
    setError("");
    pad.current?.off();
    try {
      const result = await request<{ image: string; sourceId: string }>(
        "savedSignaturePreview",
        {
          programId: saved.programId,
          participantId: saved.participantId,
          date,
          period,
          sourceId: stored.sourceId,
        },
        saved.token,
      );
      const image = new Image();
      image.src = result.image;
      await image.decode();
      if (generation.current !== current) return;
      baseImage.current = { image, sourceId: result.sourceId };
      pad.current?.clear();
      redraw.current();
      setEmpty(false);
      setLoaded(true);
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
    } finally {
      if (generation.current === current) {
        pad.current?.on();
        setLoadingPreview(false);
      }
    }
  }
  useEffect(() => {
    const c = canvas.current!;
    const p = new SignaturePad(c, {
      penColor: "#0f172a",
      minWidth: 1.3,
      maxWidth: 2.8,
      backgroundColor: "rgb(255,255,255)",
    });
    pad.current = p;
    let oldW = 0,
      oldH = 0;
    const paint = () => {
      const data = p.toData();
      p.clear();
      const base = baseImage.current?.image;
      if (base) {
        const scale = Math.min(
          (c.offsetWidth * 0.9) / base.naturalWidth,
          (c.offsetHeight * 0.9) / base.naturalHeight,
        );
        const w = base.naturalWidth * scale,
          h = base.naturalHeight * scale;
        c.getContext("2d")!.drawImage(
          base,
          (c.offsetWidth - w) / 2,
          (c.offsetHeight - h) / 2,
          w,
          h,
        );
      }
      p.fromData(data, { clear: false });
    };
    redraw.current = paint;
    const resize = () => {
      const data = p.toData();
      const w = c.offsetWidth,
        h = c.offsetHeight;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      c.width = w * ratio;
      c.height = h * ratio;
      c.getContext("2d")!.scale(ratio, ratio);
      p.clear();
      if (oldW && oldH) {
        data.forEach((g) =>
          g.points.forEach((pt) => {
            pt.x *= w / oldW;
            pt.y *= h / oldH;
          }),
        );
        p.fromData(data);
      }
      paint();
      const measure = document.createElement("canvas").getContext("2d")!;
      measure.font = "100px sans-serif";
      setGuideSize(
        Math.min(
          ((w * 0.7) /
            Math.max(1, measure.measureText(participant.name).width)) *
            100,
          h * 0.7,
        ),
      );
      oldW = w;
      oldH = h;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    p.addEventListener("endStroke", () =>
      setEmpty(!baseImage.current && p.isEmpty()),
    );
    return () => {
      generation.current++;
      observer.disconnect();
      p.off();
    };
  }, []);
  async function submit() {
    if (empty || locked) return;
    setBusy(true);
    setError("");
    pad.current?.off();
    try {
      if (saved && baseImage.current && pad.current!.toData().length === 0) {
        await request(
          "reuseSignature",
          {
            programId: saved.programId,
            participantId: saved.participantId,
            date,
            period,
            sourceId: baseImage.current.sourceId,
            requestId: requestId.current,
          },
          saved.token,
        );
        await saved.complete();
      } else await save(pad.current!.toDataURL("image/png"), requestId.current);
      close();
    } catch (e) {
      setError((e as Error).message);
      pad.current?.on();
      setBusy(false);
    }
  }
  return (
    <Modal
      title="본인 서명"
      close={() => {
        if (!locked) close();
      }}
    >
      <div className="modal-body">
        <div className="signature-person">
          <strong>{participant.name}</strong>
          <span>
            {formatDate(date)} · {PERIOD_LABEL[period]}
          </span>
        </div>
        <p className="muted">
          본인 이름을 확인하고 아래에 정자로 서명해주세요.
        </p>
        {saved && (
          <div className="saved-signature-action">
            <button
              className="btn soft full"
              disabled={locked || !stored?.available}
              onClick={reuse}
            >
              <Download size={18} />
              {loadingPreview
                ? "서명 불러오는 중…"
                : stored === undefined && !lookupError
                  ? "저장된 서명 확인 중…"
                  : stored?.available
                    ? "저장된 서명 불러오기"
                    : "저장된 서명 없음"}
            </button>
            {stored?.available && (
              <p className="small muted">
                {stored.date}에 작성한 서명을 불러온 뒤 확인하고 ‘서명 완료’를
                눌러주세요.
              </p>
            )}
            {lookupError && <p className="small muted">{lookupError}</p>}
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="signature-surface">
          <canvas aria-label="이름을 쓰는 서명 영역" ref={canvas} />
          <span
            className="signature-placeholder"
            aria-hidden="true"
            style={{ fontSize: guideSize }}
          >
            {participant.name}
          </span>
        </div>
        {loaded && (
          <p className="small muted" role="status">
            서명을 불러왔습니다. 확인 후 ‘서명 완료’를 눌러야 출석에 반영됩니다.
          </p>
        )}
        <button
          className="btn text"
          disabled={locked}
          onClick={() => {
            baseImage.current = undefined;
            pad.current?.clear();
            setLoaded(false);
            setEmpty(true);
          }}
        >
          <Eraser size={16} />
          다시 쓰기
        </button>
      </div>
      <div className="modal-footer">
        <button className="btn secondary" disabled={locked} onClick={close}>
          취소
        </button>
        <button
          className="btn primary"
          disabled={empty || locked}
          onClick={submit}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Check size={17} />
          )}{" "}
          {busy ? "서명 저장 중…" : "서명 완료"}
        </button>
      </div>
    </Modal>
  );
}
