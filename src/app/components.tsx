import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowRight, FlaskConical } from "lucide-react";
import { statusLabel } from "./context";
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>{statusLabel[status] ?? status}</span>
  );
}
export function Empty({
  title = "这里还没有内容",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <FlaskConical size={36} />
      <h3>{title}</h3>
      <p>{children ?? "完成一次评价，让数据从这里开始。"}</p>
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error-box" role="alert">
      {message}
    </div>
  ) : null;
}
export function Progress({ value, total }: { value: number; total: number }) {
  return (
    <div className="progress-wrap">
      <div className="progress">
        <span
          style={{
            width: Math.min(100, total ? (value / total) * 100 : 0) + "%",
          }}
        />
      </div>
      <span>
        {value} / {total}
      </span>
    </div>
  );
}
export function Arrow() {
  return <ArrowRight size={17} />;
}
