import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { koreaDate } from "../domain/rules";

/** Local calendar dates use UTC arithmetic to avoid browser timezone shifts. */
export function EducationCalendar({
  dates,
  onAdd,
}: {
  dates: string[];
  onAdd: (date: string) => void;
}) {
  const [month, setMonth] = useState(koreaDate().slice(0, 7));
  const [year, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  function move(delta: number) {
    setMonth(
      new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7),
    );
  }
  return (
    <div className="education-calendar">
      <div className="calendar-heading">
        <button
          type="button"
          className="icon-btn"
          aria-label="이전 달"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <strong aria-live="polite">
          {year}년 {m}월
        </strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="다음 달"
          onClick={() => move(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <p className="muted small">날짜를 누르면 교육일에 바로 추가돼요.</p>
      <div className="calendar-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <span key={d} className="calendar-weekday">
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          const selected = dates.includes(day);
          return (
            <button
              type="button"
              key={day}
              aria-label={`${day}${selected ? " 등록됨" : " 교육일 추가"}`}
              aria-pressed={selected}
              className={`calendar-day ${selected ? "selected" : ""}`}
              aria-current={day === koreaDate() ? "date" : undefined}
              onClick={() => onAdd(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
