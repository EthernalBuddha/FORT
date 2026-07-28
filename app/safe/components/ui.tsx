"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export function Msg({ m }: { m: any }) {
  if (!m?.text) return null;
  const cls = m.kind === "ok" ? "banner bannerOk" : "banner bannerErr";
  return (
    <div className={cls}>
      <div>{m.text}</div>
    </div>
  );
}

export function IconBtn({
  children,
  onClick,
  disabled,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: {
  children: any;
  onClick?: () => void;
  disabled?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <button
      className="btn"
      onClick={onClick}
      disabled={disabled}
      style={{ padding: "8px 10px", borderRadius: 14, lineHeight: 1 }}
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </button>
  );
}

export function PortalModal({
  open,
  title,
  onClose,
  children,
  width,
  showClose,
}: {
  open: boolean;
  title: string;
  onClose?: () => void;
  children: any;
  width?: string;
  showClose?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const showX = showClose !== false;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    background: "rgba(0, 8, 24, 0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "grid",
    placeItems: "center",
    padding: 18,
    minHeight: "100dvh",
  };

  const modalStyle: CSSProperties = {
    width: width || "min(520px, calc(100vw - 36px))",
    maxHeight: "min(680px, calc(100dvh - 36px))",
    overflow: "hidden",
    borderRadius: 18,
    background:
      "radial-gradient(120% 120% at 20% 10%, rgba(64, 120, 255, 0.18), rgba(6, 10, 22, 0.92))",
    border: "1px solid rgba(120, 170, 255, 0.18)",
    boxShadow: "0 22px 70px rgba(0, 0, 0, 0.55)",
    padding: 14,
    display: "flex",
    flexDirection: "column",
  };

  const headStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: showX ? "6px 44px 10px" : "6px 18px 10px",
    flex: "0 0 auto",
  };

  const titleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 650,
    letterSpacing: "-0.02em",
    textAlign: "center",
    textTransform: "uppercase",
  };

  const closeStyle: CSSProperties = {
    position: "absolute",
    right: 6,
    top: 2,
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(120, 170, 255, 0.16)",
    background: "rgba(10, 16, 34, 0.55)",
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 22,
    lineHeight: 0,
    cursor: "pointer",
  };

  return createPortal(
    <div
      className="safeModal"
      style={overlayStyle}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headStyle}>
          <div style={titleStyle}>{title}</div>
          {showX ? (
            <button style={closeStyle} onClick={onClose} aria-label="Close" type="button">
              ×
            </button>
          ) : null}
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
