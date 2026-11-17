import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { Program } from "../domain/model";

export function ProgramActions({
  title,
  status,
  busy,
  onStatus,
  onDelete,
}: {
  title: string;
  status: Program["status"];
  busy: boolean;
  onStatus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const label =
    status === "active" ? "보관" : status === "deleted" ? "복원" : "운영 재개";
  return (
    <div
      className="program-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="program-menu-trigger"
        aria-label={`${title} 더보기`}
        aria-expanded={open}
        aria-controls={id}
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={20} />
        <span>더보기</span>
      </button>
      {open && (
        <div
          className="program-menu-options"
          id={id}
          aria-label={`${title} 관리`}
        >
          <button
            disabled={busy}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onStatus();
            }}
          >
            {status === "active" ? (
              <Archive size={17} />
            ) : (
              <ArchiveRestore size={17} />
            )}
            {label}
          </button>
          {status !== "deleted" && (
            <button
              className="danger-text"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                onDelete();
              }}
            >
              <Trash2 size={17} />
              휴지통으로 이동
            </button>
          )}
        </div>
      )}
    </div>
  );
}
