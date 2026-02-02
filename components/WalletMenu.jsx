"use client";

import { useEffect, useRef, useState } from "react";

function short(a) {
  if (!a) return "";
  return a.slice(0, 6) + "..." + a.slice(-4);
}

export default function WalletMenu({ wallet, connecting, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!open) return;
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  }

  return !wallet ? (
    <button
      className="chip"
      onClick={() => {
        if (connecting) return;
        onConnect?.();
      }}
      disabled={!!connecting}
      type="button"
    >
      {connecting ? "Connecting…" : "Connect"}
    </button>
  ) : (
    <div className="menuWrap" ref={ref}>
      <button className="chip" onClick={() => setOpen((v) => !v)} type="button">
        {short(wallet)}
      </button>

      {open && (
        <div className="menuPanel">
          <button type="button" className="menuItem" onClick={copy}>
            <span className="menuLabel">{short(wallet)}</span>
            <span className="menuHint">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              )}
            </span>
          </button>

          <div className="menuSep" />

          <button
            className="btn"
            onClick={() => {
              setOpen(false);
              onDisconnect?.();
            }}
            style={{ width: "100%" }}
            type="button"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
