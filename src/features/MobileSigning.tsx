import { useCallback, useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import type { Period } from "../domain/model";
import { PERIOD_LABEL } from "../domain/model";
import { formatDate } from "../domain/rules";
import { request } from "../api";
import { Notice, Spinner } from "../components/ui";
import { SignatureDialog } from "../components/SignatureDialog";
interface Person {
  id: string;
  name: string;
  order: number;
  signed: boolean;
}
interface Roster {
  title: string;
  date: string;
  period: Period;
  open: boolean;
  participants: Person[];
}
export function MobileSigning({
  programId,
  token,
}: {
  programId: string;
  token: string;
}) {
  const [roster, setRoster] = useState<Roster>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<Person>();
  const [completed, setCompleted] = useState("");
  const load = useCallback(async () => {
    try {
      setRoster(await request<Roster>("signingRoster", { programId }, token));
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setRoster(undefined);
    }
  }, [programId, token]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (person || completed) return;
    const id = setInterval(load, 20000);
    const focus = () => {
      load();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", focus);
    };
  }, [load, person, completed]);
  if (completed)
    return (
      <section className="mobile-signing signing-complete panel" role="status">
        <div className="large-icon">
          <Check size={32} />
        </div>
        <h1>
          {completed}님<br />
          서명이 완료됐습니다
        </h1>
        <p>
          작성하신 서명이 저장됐어요.
          <br />이 화면을 닫으셔도 됩니다.
        </p>
      </section>
    );
  if (error)
    return (
      <section className="mobile-signing panel">
        <Notice error>{error}</Notice>
        <p>현장 태블릿의 QR을 다시 스캔하거나 강사에게 문의해주세요.</p>
        <button className="btn secondary" onClick={load}>
          다시 확인
        </button>
      </section>
    );
  if (!roster) return <Spinner />;
  const shown = roster.participants.filter((p) =>
    p.name.includes(query.trim()),
  );
  return (
    <section className="mobile-signing panel">
      <p className="muted">{roster.title}</p>
      <h1>
        본인 이름을
        <br />
        선택해주세요
      </h1>
      <div className="signing-slot">
        {formatDate(roster.date)} · {PERIOD_LABEL[roster.period]}
      </div>
      <p>
        아래로 내려서 이름을 찾고,
        <br />
        이름을 누른 뒤 서명해주세요.
      </p>
      {!roster.open && (
        <Notice>서명이 마감됐습니다. 강사에게 문의해주세요.</Notice>
      )}
      <label className="search">
        <Search size={22} />
        <input
          aria-label="본인 이름 찾기"
          placeholder="이름 검색 (선택사항)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="mobile-name-list">
        {shown.map((p) => (
          <button
            key={p.id}
            className="mobile-name-button"
            disabled={!roster.open || p.signed}
            onClick={() => setPerson(p)}
          >
            <span className="mobile-name-order">{p.order}번</span>
            <strong>{p.name}</strong>
            <span className="mobile-name-state">
              {p.signed ? "서명 완료" : "서명하기 →"}
            </span>
          </button>
        ))}
      </div>
      {!shown.length && <p>일치하는 이름이 없습니다. 검색어를 확인해주세요.</p>}
      {person && (
        <SignatureDialog
          participant={person}
          date={roster.date}
          period={roster.period}
          close={() => setPerson(undefined)}
          save={async (image, requestId) => {
            await request(
              "sign",
              {
                programId,
                participantId: person.id,
                date: roster.date,
                period: roster.period,
                image,
                requestId,
              },
              token,
            );
            setCompleted(person.name);
          }}
        />
      )}
    </section>
  );
}
