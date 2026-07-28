"use client";

import { type CSSProperties } from "react";

import { short } from "../lib/format";

export type SafeRowProps = {
  address: string;
  name: string;
  active: boolean;
  hidden: boolean;
  menuOpen: boolean;
  openUp: boolean;
  onSelect: (address: string) => void;
  onToggleMenu: (address: string) => void;
  onRename: (address: string) => void;
  onToggleHide: (address: string) => void;
};

export function SafeRow({
  address,
  name,
  active,
  hidden,
  menuOpen,
  openUp,
  onSelect,
  onToggleMenu,
  onRename,
  onToggleHide,
}: SafeRowProps) {
  const wrapStyle: CSSProperties = {
    width: "100%",
    borderRadius: 16,
    border: active
      ? "1px solid rgba(80, 220, 170, 0.28)"
      : "1px solid rgba(120, 170, 255, 0.14)",
    background: active ? "rgba(80, 220, 170, 0.08)" : "rgba(12, 18, 38, 0.5)",
    display: "flex",
    alignItems: "stretch",
    overflow: "hidden",
  };

  const selectBtnStyle: CSSProperties = {
    flex: "1 1 auto",
    minWidth: 0,
    display: "block",
    textAlign: "left",
    padding: "13px 13px",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    appearance: "none",
    WebkitAppearance: "none",
  };

  const kebabBtnStyle: CSSProperties = {
    flex: "0 0 auto",
    width: 46,
    display: "grid",
    placeItems: "center",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    appearance: "none",
    WebkitAppearance: "none",
  };

  const menuBaseStyle: CSSProperties = {
    position: "absolute",
    right: 0,
    zIndex: 30,
    borderRadius: 12,
    background: "rgba(10, 18, 40, 0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(120, 170, 255, 0.15)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
  };

  const menuWrapStyle: CSSProperties = openUp
    ? { ...menuBaseStyle, bottom: 44 }
    : { ...menuBaseStyle, top: 44 };

  return (
    <div style={{ position: "relative" }} data-rowmenu>
      <div style={wrapStyle}>
        <button
          type="button"
          style={selectBtnStyle}
          onClick={() => onSelect(address)}
        >
          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 780,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ opacity: 0.98 }}>{name || "Unnamed Safe"}</span>
                <span
                  className="muted"
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  {short(address)}
                </span>
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          aria-label="Open menu"
          style={kebabBtnStyle}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleMenu(address);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="2.2" fill="rgba(255,255,255,0.85)" />
            <circle cx="12" cy="12" r="2.2" fill="rgba(255,255,255,0.85)" />
            <circle cx="12" cy="19" r="2.2" fill="rgba(255,255,255,0.85)" />
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <div style={menuWrapStyle}>
          <button
            type="button"
            className="menuIconBtn"
            onClick={() => onRename(address)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4.5a2.1 2.1 0 0 0-3 0L3 15v5z"
                fill="none"
                stroke="rgba(80,220,170,0.9)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="menuIconLabel">Rename</span>
          </button>

          <button
            type="button"
            className="menuIconBtn"
            onClick={() => onToggleHide(address)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              {hidden ? (
                <path
                  d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
                  fill="none"
                  stroke="rgba(80,220,170,0.9)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <>
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                    fill="none"
                    stroke="rgba(160,160,160,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line
                    x1="1"
                    y1="1"
                    x2="23"
                    y2="23"
                    stroke="rgba(160,160,160,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
            <span className="menuIconLabel">{hidden ? "Unhide" : "Hide"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
