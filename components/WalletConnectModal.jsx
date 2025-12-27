"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./WalletConnectModal.module.css";

const CATALOG = [
  { id: "metamask", name: "MetaMask", icon: "/wallets/metamask.png" },
  { id: "rabby", name: "Rabby Wallet", icon: "/wallets/rabby.png" },
  { id: "coinbase", name: "Coinbase Wallet", icon: "/wallets/coinbase.png" },
  { id: "binance", name: "Binance Wallet", icon: "/wallets/binance.png" },
  { id: "phantom", name: "Phantom", icon: "/wallets/phantom.png" },
  { id: "zerion", name: "Zerion", icon: "/wallets/zerion.png" },
  { id: "rainbow", name: "Rainbow", icon: "/wallets/rainbow.png" },
  { id: "trust", name: "Trust Wallet", icon: "/wallets/trust.png" },
  { id: "okx", name: "OKX Wallet", icon: "/wallets/okx.png" },
];

function s(x) {
  return typeof x === "string" ? x : "";
}

function guessIdFromRdnsName(rdns, name) {
  const r = (s(rdns) + " " + s(name)).toLowerCase();
  if (r.includes("metamask")) return "metamask";
  if (r.includes("rabby")) return "rabby";
  if (r.includes("coinbase")) return "coinbase";
  if (r.includes("binance")) return "binance";
  if (r.includes("phantom")) return "phantom";
  if (r.includes("zerion")) return "zerion";
  if (r.includes("rainbow")) return "rainbow";
  if (r.includes("trust")) return "trust";
  if (r.includes("okx") || r.includes("okex")) return "okx";
  return "";
}

function guessIdFromInjected(p) {
  if (!p) return "";
  if (p.isRabby) return "rabby";
  if (p.isMetaMask) return "metamask";
  if (p.isCoinbaseWallet) return "coinbase";
  if (p.isBinance || p.isBinanceWallet) return "binance";
  if (p.isPhantom) return "phantom";
  if (p.isZerion) return "zerion";
  if (p.isRainbow) return "rainbow";
  if (p.isTrust || p.isTrustWallet) return "trust";
  if (p.isOKXWallet || p.isOkxWallet) return "okx";
  return "";
}

function uniqProviders(arr) {
  const out = [];
  for (const p of arr || []) {
    if (!p) continue;
    if (out.some((x) => x === p)) continue;
    out.push(p);
  }
  return out;
}

export default function WalletConnectModal({ open, onClose, onSelect }) {
  const [mounted, setMounted] = useState(false);
  const [announced, setAnnounced] = useState([]);
  const [injected, setInjected] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;

    const onAnnounce = (event) => {
      try {
        const d = event?.detail;
        const info = d?.info || {};
        const provider = d?.provider;
        if (!provider) return;

        setAnnounced((cur) => {
          if (cur.some((x) => x?.provider === provider)) return cur;
          return [...cur, { provider, info }];
        });
      } catch {}
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch {}

    try {
      const eth = window.ethereum;
      const ps = Array.isArray(eth?.providers) && eth.providers.length ? eth.providers : eth ? [eth] : [];
      setInjected(uniqProviders(ps));
    } catch {
      setInjected([]);
    }

    return () => {
      try {
        window.removeEventListener("eip6963:announceProvider", onAnnounce);
      } catch {}
    };
  }, [mounted]);

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
    const onKey = (e) => {
      if (e.key === "Escape" && !busyId) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busyId]);

  const list = useMemo(() => {
    const providerById = {};

    for (const a of announced) {
      const info = a?.info || {};
      const provider = a?.provider;
      const id = guessIdFromRdnsName(info?.rdns, info?.name);
      if (id && !providerById[id]) providerById[id] = provider;
    }

    for (const p of injected) {
      const id = guessIdFromInjected(p);
      if (id && !providerById[id]) providerById[id] = p;
    }

    return CATALOG.map((c) => ({
      ...c,
      provider: providerById[c.id] || null,
      available: !!providerById[c.id],
      key: `wallet:${c.id}`,
    }));
  }, [announced, injected]);

  if (!open || !mounted) return null;

  const canClose = !busyId;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      onMouseDown={() => {
        if (canClose) onClose?.();
      }}
    >
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div className={styles.title}>Connect wallet</div>
          <button
            className={styles.close}
            type="button"
            aria-label="Close"
            onClick={() => {
              if (canClose) onClose?.();
            }}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.list}>
            {list.map((w) => {
              const isBusy = busyId === w.id;
              const disabled = !!busyId || !w.available;
              const showDetected = w.available && !isBusy;
              const isBig = w.id === "phantom" || w.id === "rainbow";
              const isCoinbase = w.id === "coinbase";

              const metaText = isBusy ? "Connecting…" : w.available ? "Detected" : "Not detected";
              const metaStyle = showDetected ? { color: "rgba(170,255,220,0.78)" } : undefined;

              return (
                <button
                  key={w.key}
                  type="button"
                  className={styles.item}
                  disabled={disabled}
                  onClick={async () => {
                    if (!w.available) return;
                    setNote("");
                    setBusyId(w.id);
                    try {
                      const ok = await onSelect?.(w.provider, w.id);
                      if (ok) onClose?.();
                      else setNote("Open your wallet and try again.");
                    } catch {
                      setNote("Open your wallet and try again.");
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  <div className={styles.left}>
                    <div className={`${styles.iconWrap} ${isCoinbase ? styles.iconWrapCoinbase : ""}`}>
                      {w.icon ? (
                        <img
                          className={`${styles.icon} ${isBig ? styles.iconBig : ""} ${isCoinbase ? styles.iconCoinbase : ""}`}
                          src={w.icon}
                          alt=""
                        />
                      ) : null}
                    </div>
                    <div className={styles.name}>{w.name}</div>
                  </div>
                  <div className={styles.meta} style={metaStyle}>
                    {metaText}
                  </div>
                </button>
              );
            })}
          </div>

          {note ? <div className={styles.note}>{note}</div> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
