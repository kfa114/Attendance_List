import { useEffect, useRef, useState } from "react";
import { QrCode, Copy } from "lucide-react";
import { request } from "../api";
import type { Period } from "../domain/model";
import { PERIOD_LABEL } from "../domain/model";
import { formatDate } from "../domain/rules";

export function SigningQr({
  programId,
  date,
  period,
  token,
  enabled,
}: {
  programId: string;
  date: string;
  period: Period;
  token: string;
  enabled: boolean;
}) {
  const [qr, setQr] = useState<{
    url: string;
    image: string;
    expiresAt: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setQr(undefined);
    setError("");
    setBusy(false);
    setCopied(false);
    return () => {
      generation.current++;
    };
  }, [programId, date, period, token, enabled]);
  async function generate() {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ url: string; expiresAt: number }>(
        "signingSession",
        { programId, date, period },
        token,
      );
      const url = result.url.startsWith("#")
        ? `${location.href.split("#")[0]}${result.url}`
        : result.url;
      const QRCode = await import("qrcode");
      const image = await QRCode.toDataURL(url, {
        width: 600,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      if (current === generation.current)
        setQr({ url, image, expiresAt: result.expiresAt });
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const usableUntil = qr
    ? Math.min(
        qr.expiresAt,
        Date.parse(`${date}T${period === "am" ? "13" : "18"}:00:00+09:00`),
      )
    : 0;
  const visible = enabled && qr && usableUntil > Date.now();
  return (
    <section className="signing-qr">
      <div className="qr-copy">
        <h3>
          <QrCode size={22} /> 휴대폰 QR 서명
        </h3>
        {!visible && <p>QR 스캔 → 이름 선택 → 서명 완료</p>}
        <strong>
          {date && formatDate(date)} · {PERIOD_LABEL[period]}
        </strong>
        {!visible && (
          <button
            className="btn primary"
            disabled={!enabled || busy}
            onClick={generate}
          >
            <QrCode size={20} />
            {busy ? "QR 만드는 중…" : "휴대폰 서명 QR 생성"}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      {visible && (
        <div className="qr-display">
          <img
            src={qr.image}
            alt={`${date} ${PERIOD_LABEL[period]} 휴대폰 서명 접속 QR 코드`}
            width={300}
            height={300}
          />
          <p className="small muted">
            {new Date(usableUntil).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              minute: "2-digit",
            })}
            까지 사용 가능
          </p>
          <button
            className="btn secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(qr.url);
                setCopied(true);
              } catch {
                setError("링크 복사에 실패했습니다. QR로 접속해주세요.");
              }
            }}
          >
            <Copy size={16} />
            {copied ? "복사했습니다" : "서명 링크 복사"}
          </button>
          <a href={qr.url} target="_blank" rel="noopener noreferrer">
            휴대폰 서명 화면 열기 ↗
          </a>
        </div>
      )}
    </section>
  );
}
