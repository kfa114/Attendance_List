import {
  X,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,[tabindex="0"]',
          ) || []),
        ];
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", fn);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", fn);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="닫기">
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Spinner() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> 불러오고 있어요
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : undefined}
    >
      {error ? <CircleAlert size={17} /> : <CircleCheck size={17} />}
      <span>{children}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  label = "새 명단 만들기",
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderOpen size={32} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="btn primary" onClick={action}>
          {label}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
export function Badge({
  children,
  color = "blue",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}
