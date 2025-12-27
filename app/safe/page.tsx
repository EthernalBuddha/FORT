"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ethers } from "ethers";
import styles from "./page.module.css";
import WalletMenu from "../../components/WalletMenu";
import WalletConnectModal from "../../components/WalletConnectModal";

const FACTORY_ADDRESS = "0xd09B0e8c53354Bf0865940371FD6ff98874D1b89";
const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_ID_HEX = "0x4cef52";

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

const NATIVE_SYMBOL = "USDC";
const NATIVE_DECIMALS = 18;

const THRESHOLD = 2;

const EXPLORER_TX_PREFIX = process.env.NEXT_PUBLIC_ARC_EXPLORER_TX || `${ARC_EXPLORER_BASE}/tx/`;

const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: "Arc Testnet",
  rpcUrls: [ARC_RPC_URL],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: NATIVE_DECIMALS },
  blockExplorerUrls: [ARC_EXPLORER_BASE],
};

const FACTORY_ABI = [
  "event SaveCreated(address save, address[3] owners)",
  "function createSave(address[3] owners) payable returns (address)",
];

const SAFE_ABI = [
  "function owners(uint256) view returns (address)",
  "function txs(uint256) view returns (address to, uint256 amount, bool executed, uint8 confirms)",
  "function confirmed(uint256, address) view returns (bool)",
  "function createTx(address to, uint256 amount) returns (uint256)",
  "function confirmTx(uint256 id)",
  "function executeTx(uint256 id)",
];

const NAME_PREFIX = "arcsafe:safeName:";
const SAFES_BY_WALLET_PREFIX = "arcsafe:safesByWallet:";
const TXHASH_PREFIX = "arcsafe:txHash:";
const SCAN_BLOCK_PREFIX = "arcsafe:scanBlock:";

const FACTORY_FROM_BLOCK = Number(process.env.NEXT_PUBLIC_FACTORY_FROM_BLOCK || 0);
const LOG_CHUNK = Number(process.env.NEXT_PUBLIC_FACTORY_LOG_CHUNK || 35000);

function normAddr(x: string) {
  const a = (x || "").trim();
  if (!ethers.isAddress(a)) return null;
  return ethers.getAddress(a);
}

function short(a: string) {
  if (!a) return "";
  return a.slice(0, 6) + "..." + a.slice(-4);
}

function errText(e: any) {
  if (e?.code === "TIMEOUT") return "Wallet request timed out. Open wallet and confirm.";
  if (e?.code === -32002) return "Wallet request already pending. Open wallet.";
  if (e?.code === 4001) return "Request rejected in wallet.";
  return (
    e?.shortMessage ||
    e?.reason ||
    e?.info?.error?.message ||
    e?.data?.message ||
    e?.message ||
    (typeof e === "string" ? e : "") ||
    "Unknown error"
  );
}

function isAddChainErr(e: any) {
  const code =
    e?.code ??
    e?.data?.originalError?.code ??
    e?.data?.code ??
    e?.error?.code ??
    e?.info?.error?.code ??
    e?.info?.error?.data?.originalError?.code;

  if (code === 4902) return true;

  const msg = String(
    e?.shortMessage ||
      e?.message ||
      e?.info?.error?.message ||
      e?.data?.message ||
      e?.data?.originalError?.message ||
      ""
  ).toLowerCase();

  if (!msg) return false;

  return (
    msg.includes("unrecognized chain") ||
    msg.includes("unknown chain") ||
    msg.includes("chain is not added") ||
    (msg.includes("not added") && msg.includes("chain")) ||
    msg.includes("add ethereum chain") ||
    msg.includes("wallet_addethereumchain")
  );
}

function txUrl(hash: string) {
  const h = (hash || "").trim();
  if (!h) return "";
  const p = (EXPLORER_TX_PREFIX || "").trim();
  if (!p) return "";
  return p.endsWith("/") ? p + h : p + "/" + h;
}

function getStoredName(addr: string) {
  try {
    if (!addr) return "";
    return localStorage.getItem(NAME_PREFIX + addr.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function setStoredName(addr: string, name: string) {
  try {
    if (!addr) return;
    const key = NAME_PREFIX + addr.toLowerCase();
    const v = (name || "").trim();
    if (!v) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {}
}

function parseSafesRaw(raw: string) {
  const out: string[] = [];
  const push = (v: string) => {
    const a = normAddr(v);
    if (!a) return;
    if (!out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  };

  if (!raw || typeof raw !== "string") return out;

  const s = raw.trim();
  if (!s) return out;

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      parsed.forEach((x) => push(typeof x === "string" ? x : ""));
      return out;
    }
  } catch {}

  const matches = s.match(/0x[a-fA-F0-9]{40}/g);
  if (matches && matches.length) {
    matches.forEach((m) => push(m));
    return out;
  }

  s.split(/[\s,;|]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((x) => push(x));

  return out;
}

function getSafesForWallet(wallet: string) {
  try {
    if (!wallet) return [] as string[];
    const key = SAFES_BY_WALLET_PREFIX + wallet.toLowerCase();
    const raw = localStorage.getItem(key) || "";
    const arr = parseSafesRaw(raw);

    const looksJson = raw.trim().startsWith("[");
    if (raw && !looksJson) {
      try {
        localStorage.setItem(key, JSON.stringify(arr));
      } catch {}
    }

    return arr;
  } catch {
    return [] as string[];
  }
}

function addSafeForWallet(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;

    const key = SAFES_BY_WALLET_PREFIX + w;
    const cur = getSafesForWallet(wallet);

    const exists = cur.some((x) => x.toLowerCase() === s.toLowerCase());
    const next = exists ? cur : [s, ...cur];

    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function getStoredTxHash(safe: string, id: number) {
  try {
    const s = normAddr(safe);
    const i = Number(id);
    if (!s || !Number.isFinite(i) || i < 0) return "";
    return localStorage.getItem(`${TXHASH_PREFIX}${s.toLowerCase()}:${i}`) || "";
  } catch {
    return "";
  }
}

function setStoredTxHash(safe: string, id: number, hash: string) {
  try {
    const s = normAddr(safe);
    const i = Number(id);
    const h = (hash || "").trim();
    if (!s || !Number.isFinite(i) || i < 0 || !h) return;
    localStorage.setItem(`${TXHASH_PREFIX}${s.toLowerCase()}:${i}`, h);
  } catch {}
}

function setSafeParamInUrl(a: string, name: string) {
  try {
    const u = new URL(window.location.href);
    if (a) u.searchParams.set("safe", a);
    else u.searchParams.delete("safe");

    const n = (name || "").trim();
    if (a && n) u.searchParams.set("name", n);
    else u.searchParams.delete("name");

    window.history.replaceState({}, "", u.toString());
  } catch {}
}

function Msg({ m }: { m: any }) {
  if (!m?.text) return null;
  const cls = m.kind === "ok" ? "banner bannerOk" : "banner bannerErr";
  return (
    <div className={cls}>
      <div>{m.text}</div>
    </div>
  );
}

function IconBtn({
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

function PortalModal({
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
    <div className="safeModal" style={overlayStyle} onMouseDown={onClose} role="dialog" aria-modal="true">
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

export default function Page() {
  const providersRef = useRef<Record<string, any>>({});
  const ethRef = useRef<any>(null);
  const walletRef = useRef<string>("");
  const autoSwitchRef = useRef(false);

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletProviderKey, setWalletProviderKey] = useState("");

  const [wallet, setWallet] = useState("");
  const [provider, setProvider] = useState<any>(null);
  const [signer, setSigner] = useState<any>(null);
  const [chainId, setChainId] = useState(0);

  const [createSafeOpen, setCreateSafeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const [createStep, setCreateStep] = useState(0);
  const [newSafeName, setNewSafeName] = useState("");
  const [owner1, setOwner1] = useState("");
  const [owner2, setOwner2] = useState("");
  const [owner3, setOwner3] = useState("");

  const [safeSearch, setSafeSearch] = useState("");
  const [importAddr, setImportAddr] = useState("");

  const [safeAddress, setSafeAddress] = useState("");
  const [loadedSafe, setLoadedSafe] = useState("");

  const [owners, setOwners] = useState<string[]>([]);
  const [balance, setBalance] = useState("0");
  const [txs, setTxs] = useState<
    { id: number; to: string; amount: bigint; executed: boolean; confirms: number }[]
  >([]);
  const [txHashes, setTxHashes] = useState<Record<number, string>>({});
  const [txConfirmedByOwner, setTxConfirmedByOwner] = useState<Record<number, boolean[]>>({});

  const [txTo, setTxTo] = useState("");
  const [txAmount, setTxAmount] = useState("");

  const [ownerIndex, setOwnerIndex] = useState(-1);
  const [access, setAccess] = useState<"none" | "checking" | "owner" | "denied">("none");

  const [loadingSafe, setLoadingSafe] = useState(false);
  const [safeErr, setSafeErr] = useState("");

  const [createdSafes, setCreatedSafes] = useState<string[]>([]);

  const [walletMsg, setWalletMsg] = useState<any>(null);
  const [createMsg, setCreateMsg] = useState<any>(null);
  const [txMsg, setTxMsg] = useState<any>(null);

  const [pending, setPending] = useState({
    connect: false,
    createSafe: false,
    createTx: false,
    txAction: null as null | { id: number; action: "confirm" | "execute" },
    switchNet: false,
    syncSafes: false,
  });

  const [copiedOwner, setCopiedOwner] = useState("");
  const [copiedSafe, setCopiedSafe] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  const [rowMenuOpenFor, setRowMenuOpenFor] = useState<string>("");

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameAddr, setRenameAddr] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeAddr, setRemoveAddr] = useState("");

  const [copyTipOpen, setCopyTipOpen] = useState(false);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  function isArc(id: number | string) {
    return Number(id || 0) === ARC_CHAIN_ID;
  }

  function getEthByKey(key: string) {
    return providersRef.current?.[key] || null;
  }

  function timeout(ms: number) {
    return new Promise((_, reject) => {
      const er: any = new Error("Wallet request timed out");
      er.code = "TIMEOUT";
      setTimeout(() => reject(er), ms);
    });
  }

  async function ethReq(eth: any, method: string, params?: any, ms = 25000) {
    if (!eth?.request) throw new Error("Wallet not found");
    const p = params === undefined ? eth.request({ method }) : eth.request({ method, params });
    return await Promise.race([p, timeout(ms)]);
  }

  async function readChainIdDirect(eth: any) {
    try {
      if (!eth?.request) return 0;
      const hex = await ethReq(eth, "eth_chainId", undefined, 6000);
      if (typeof hex !== "string") return 0;
      const v = parseInt(hex, 16);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  async function ensureConnected(eth: any) {
    if (!eth?.request) throw new Error("Wallet not found");
    try {
      const accs = await ethReq(eth, "eth_accounts", undefined, 6000);
      if (Array.isArray(accs) && accs.length) return true;
    } catch {}
    await ethReq(eth, "eth_requestAccounts", undefined, 25000);
    return true;
  }

  async function ensureReadProvider() {
    if (walletProviderKey) {
      const eth = getEthByKey(walletProviderKey);
      if (eth?.request) {
        const p = new ethers.BrowserProvider(eth);
        setProvider(p);
        const cid = await readChainIdDirect(eth);
        if (cid) setChainId(cid);
        return { provider: p, eth, kind: "wallet" as const };
      }
    }

    const p = new ethers.JsonRpcProvider(ARC_RPC_URL);
    setProvider(p);
    setChainId(ARC_CHAIN_ID);
    return { provider: p, eth: null, kind: "rpc" as const };
  }

  async function ensureArcNetwork(eth: any) {
    if (!eth?.request) throw new Error("Wallet not found");

    const current = await readChainIdDirect(eth);
    if (isArc(current)) return true;

    setPending((x) => ({ ...x, switchNet: true }));
    try {
      try {
        await ethReq(eth, "wallet_switchEthereumChain", [{ chainId: ARC_CHAIN_ID_HEX }], 25000);
      } catch (e: any) {
        if (isAddChainErr(e)) {
          await ethReq(eth, "wallet_addEthereumChain", [ARC_CHAIN_PARAMS], 25000);
          await ethReq(eth, "wallet_switchEthereumChain", [{ chainId: ARC_CHAIN_ID_HEX }], 25000);
        } else {
          throw e;
        }
      }

      const after = await readChainIdDirect(eth);
      if (after) setChainId(after);
      return isArc(after);
    } finally {
      setPending((x) => ({ ...x, switchNet: false }));
    }
  }

  function getLastScanBlock(w: string) {
    try {
      const a = normAddr(w);
      if (!a) return 0;
      const raw = localStorage.getItem(SCAN_BLOCK_PREFIX + a.toLowerCase()) || "";
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch {
      return 0;
    }
  }

  function setLastScanBlock(w: string, b: number) {
    try {
      const a = normAddr(w);
      const v = Number(b);
      if (!a || !Number.isFinite(v) || v < 0) return;
      localStorage.setItem(SCAN_BLOCK_PREFIX + a.toLowerCase(), String(v));
    } catch {}
  }

  async function syncSafesFromChain(walletAddr: string, p: any) {
    const w = normAddr(walletAddr);
    if (!w || !p?.getLogs || !p?.getBlockNumber) return;

    setPending((x) => ({ ...x, syncSafes: true }));
    try {
      const latest = await p.getBlockNumber();
      const last = getLastScanBlock(w);
      const start0 = Math.max(FACTORY_FROM_BLOCK, last ? last + 1 : FACTORY_FROM_BLOCK);
      if (start0 > latest) {
        setLastScanBlock(w, latest);
        setCreatedSafes(getSafesForWallet(w));
        return;
      }

      const iface = new ethers.Interface(FACTORY_ABI);
      const topic0 = ethers.id("SaveCreated(address,address[3])");

      const step = Math.max(2000, LOG_CHUNK);
      for (let from = start0; from <= latest; from += step) {
        const to = Math.min(latest, from + step - 1);
        let logs: any[] = [];
        try {
          logs = await p.getLogs({
            address: FACTORY_ADDRESS,
            fromBlock: from,
            toBlock: to,
            topics: [topic0],
          });
        } catch {
          logs = [];
        }

        for (const lg of logs) {
          try {
            const parsed = iface.parseLog(lg);
            const save = normAddr(parsed?.args?.save);
            const ownersArr = Array.isArray(parsed?.args?.owners) ? parsed.args.owners : [];
            const hit = ownersArr.some((o: string) => (o || "").toLowerCase() === w.toLowerCase());
            if (hit && save) addSafeForWallet(w, save);
          } catch {}
        }
      }

      setLastScanBlock(w, latest);
      setCreatedSafes(getSafesForWallet(w));
    } finally {
      setPending((x) => ({ ...x, syncSafes: false }));
    }
  }

  async function connectSelected(eth: any, key: string) {
    setWalletMsg(null);
    setPending((x) => ({ ...x, connect: true }));

    try {
      if (!eth?.request) {
        setWalletMsg({ kind: "err", text: "Selected wallet is not detected." });
        return false;
      }

      ethRef.current = eth;
      providersRef.current = { ...(providersRef.current || {}), [key]: eth };
      setWalletProviderKey(key);

      await ensureConnected(eth);

      const ok = await ensureArcNetwork(eth);
      if (!ok) {
        setWalletMsg({ kind: "err", text: `Switch to Arc Testnet (${ARC_CHAIN_ID}).` });
        return false;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const a2 = await s2.getAddress();

      setProvider(p2);
      setSigner(s2);
      setWallet(a2);
      setCreatedSafes(getSafesForWallet(a2));
      setWalletModalOpen(false);

      const cid = await readChainIdDirect(eth);
      if (cid) setChainId(cid);

      void syncSafesFromChain(a2, p2);
      if (loadedSafe) void loadSafe(loadedSafe, { provider: p2, signer: s2 }, a2);

      return true;
    } catch (e) {
      setWalletMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setPending((x) => ({ ...x, connect: false }));
    }
  }

  function disconnectWallet() {
    setWalletModalOpen(false);
    setWallet("");
    setSigner(null);
    setOwnerIndex(-1);
    setAccess("none");
    setWalletMsg(null);
    setCreatedSafes([]);
    setOwners([]);
    setTxs([]);
    setTxHashes({});
    setTxConfirmedByOwner({});
    setBalance("0");
    setWalletProviderKey("");
    ethRef.current = null;
    setRowMenuOpenFor("");
    setRenameOpen(false);
    setRemoveOpen(false);
    setPending((x) => ({
      ...x,
      connect: false,
      switchNet: false,
      syncSafes: false,
      txAction: null,
    }));
  }

  useEffect(() => {
    if (!wallet) return;
    const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
    if (!eth?.request) return;
    if (pending.switchNet) return;
    if (chainId && isArc(chainId)) return;
    if (autoSwitchRef.current) return;

    autoSwitchRef.current = true;
    (async () => {
      try {
        await ensureConnected(eth);
        const ok = await ensureArcNetwork(eth);
        if (ok && loadedSafe) await loadSafe(loadedSafe);
      } catch {}
      finally {
        autoSwitchRef.current = false;
      }
    })();
  }, [wallet, chainId, walletProviderKey, loadedSafe, pending.switchNet]);

  function copySafe(x: string) {
    try {
      navigator.clipboard.writeText(x);
      setCopiedSafe(x);
      setTimeout(() => setCopiedSafe(""), 900);
    } catch {}
  }

  function copySafeLink() {
    try {
      if (!loadedSafe) return;
      const u = new URL(window.location.href);
      u.searchParams.set("safe", loadedSafe);

      const n = (getStoredName(loadedSafe) || "").trim();
      if (n) u.searchParams.set("name", n);
      else u.searchParams.delete("name");

      navigator.clipboard.writeText(u.toString());
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 900);
    } catch {}
  }

  function removeSafeForWallet(walletAddr: string, safeAddr: string) {
    try {
      const w = normAddr(walletAddr);
      const s = normAddr(safeAddr);
      if (!w || !s) return;
      const key = SAFES_BY_WALLET_PREFIX + w.toLowerCase();
      const cur = getSafesForWallet(w);
      const next = cur.filter((x) => x.toLowerCase() !== s.toLowerCase());
      localStorage.setItem(key, JSON.stringify(next));
      setCreatedSafes(next);
      if (loadedSafe && loadedSafe.toLowerCase() === s.toLowerCase()) {
        setLoadedSafe("");
        setSafeAddress("");
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setAccess("none");
        setOwnerIndex(-1);
        setSafeErr("");
        setSafeParamInUrl("", "");
      }
    } catch {}
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as any;
      if (!t?.closest) return;
      if (t.closest("[data-rowmenu]")) return;
      setRowMenuOpenFor("");
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const s = u.searchParams.get("safe") || "";
      const n = u.searchParams.get("name") || "";
      const a = normAddr(s);
      if (a) {
        if (n && n.trim()) setStoredName(a, n.trim());
        setSafeAddress(a);
        loadSafe(a);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!wallet || !loadedSafe) return;
    loadSafe(loadedSafe, undefined, wallet);
  }, [wallet, loadedSafe]);

  useEffect(() => {
    const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
    if (!eth?.on) return;

    const onAccounts = async () => {
      try {
        const p = new ethers.BrowserProvider(eth);
        setProvider(p);

        const cid = await readChainIdDirect(eth);
        if (cid) setChainId(cid);

        let s2: any = null;
        let addr = "";

        try {
          s2 = await p.getSigner();
          addr = await s2.getAddress();
        } catch {}

        if (s2 && addr) {
          setSigner(s2);
          setWallet(addr);
          setCreatedSafes(getSafesForWallet(addr));
          void syncSafesFromChain(addr, p);
        } else {
          setSigner(null);
          setWallet("");
          setCreatedSafes([]);
          setAccess("none");
          setOwnerIndex(-1);
        }

        if (loadedSafe) {
          void loadSafe(
            loadedSafe,
            s2 ? { provider: p, signer: s2 } : { provider: p, signer: null },
            addr || ""
          );
        }
      } catch {}
    };

    const onChain = async () => {
      try {
        const p = new ethers.BrowserProvider(eth);
        setProvider(p);

        const cid = await readChainIdDirect(eth);
        if (cid) setChainId(cid);

        let s2: any = null;
        let addr = "";

        try {
          s2 = await p.getSigner();
          addr = await s2.getAddress();
          setSigner(s2);
          setWallet(addr);
          setCreatedSafes(getSafesForWallet(addr));
          void syncSafesFromChain(addr, p);
        } catch {}

        if (loadedSafe) {
          void loadSafe(
            loadedSafe,
            s2 ? { provider: p, signer: s2 } : { provider: p, signer: null },
            addr || ""
          );
        }
      } catch {}
    };

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);

    return () => {
      try {
        eth.removeListener("accountsChanged", onAccounts);
        eth.removeListener("chainChanged", onChain);
      } catch {}
    };
  }, [walletProviderKey, loadedSafe]);

  async function loadSafe(addr: string, override?: { provider?: any; signer?: any }, walletAddr?: string) {
    setSafeErr("");
    setLoadingSafe(true);

    try {
      const a = normAddr(addr);
      if (!a) {
        setSafeErr("Invalid safe address");
        setLoadingSafe(false);
        return;
      }

      setSafeAddress(a);
      setLoadedSafe(a);
      setSafeParamInUrl(a, "");

      const activeWallet = walletAddr || walletRef.current || "";
      const hasWallet = !!activeWallet && ethers.isAddress(activeWallet);

      let p = override?.provider || provider;
      let eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;

      if (!p) {
        const r = await ensureReadProvider();
        p = r.provider;
        eth = r.eth;
      }

      const cid = eth ? await readChainIdDirect(eth) : ARC_CHAIN_ID;
      if (cid) setChainId(cid);

      if (!isArc(cid)) {
        setAccess("none");
        setOwnerIndex(-1);
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setSafeErr(`Wrong network. Switch to Arc Testnet (${ARC_CHAIN_ID}).`);
        setLoadingSafe(false);
        return;
      }

      const code = await p.getCode(a);
      if (!code || code === "0x") {
        setAccess("none");
        setOwnerIndex(-1);
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setSafeErr("No contract at this address on current network");
        setLoadingSafe(false);
        return;
      }

      if (!hasWallet) {
        setAccess("none");
        setOwnerIndex(-1);
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setSafeErr("");
        setLoadingSafe(false);
        return;
      }

      setAccess("checking");

      const reader = new ethers.Contract(a, SAFE_ABI, p);

      let ownersArr: string[] = [];
      try {
        const from = ethers.getAddress(activeWallet);
        const a0 = await (reader as any).owners(0, { from });
const a1 = await (reader as any).owners(1, { from });
const a2 = await (reader as any).owners(2, { from });

        ownersArr = [a0, a1, a2];
      } catch {
        setAccess("denied");
        setOwnerIndex(-1);
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setSafeErr("Access denied. You are not an owner of this safe.");
        setLoadingSafe(false);
        return;
      }

      const cur = activeWallet.toLowerCase();
      let idx = -1;
      ownersArr.forEach((o, i) => {
        if ((o || "").toLowerCase() === cur) idx = i;
      });

      if (idx < 0) {
        setAccess("denied");
        setOwnerIndex(-1);
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setBalance("0");
        setSafeErr("Access denied. You are not an owner of this safe.");
        setLoadingSafe(false);
        return;
      }

      setAccess("owner");
      setOwnerIndex(idx);
      setOwners(ownersArr);

      const n = (getStoredName(a) || "").trim();
      setSafeParamInUrl(a, n);

      const bal = await p.getBalance(a);
      setBalance(ethers.formatUnits(bal, NATIVE_DECIMALS));

      const items: { id: number; to: string; amount: bigint; executed: boolean; confirms: number }[] = [];

      const from = ethers.getAddress(activeWallet);
      for (let i = 0; i < 1000; i++) {
        try {
          const t = await reader.txs(i, { from });
          items.push({
            id: i,
            to: t.to,
            amount: t.amount,
            executed: t.executed,
            confirms: Number(t.confirms),
          });
        } catch {
          break;
        }
      }
      setTxs(items);

      const map: Record<number, string> = {};
      for (const it of items) {
        const h = getStoredTxHash(a, it.id);
        if (h) map[it.id] = h;
      }
      setTxHashes(map);

      const sigMap: Record<number, boolean[]> = {};
      for (const it of items) {
        const sigs: boolean[] = [];
        for (let j = 0; j < 3; j++) {
          try {
            const ok = await reader.confirmed(it.id, ownersArr[j], { from });
            sigs.push(!!ok);
          } catch {
            sigs.push(false);
          }
        }
        sigMap[it.id] = sigs;
      }
      setTxConfirmedByOwner(sigMap);

      addSafeForWallet(activeWallet, a);
      setCreatedSafes(getSafesForWallet(activeWallet));
    } catch (e) {
      setAccess("none");
      setOwnerIndex(-1);
      setOwners([]);
      setTxs([]);
      setTxHashes({});
      setTxConfirmedByOwner({});
      setBalance("0");
      setSafeErr(errText(e));
    } finally {
      setLoadingSafe(false);
    }
  }

  async function createSafe() {
    setCreateMsg(null);
    setPending((x) => ({ ...x, createSafe: true }));

    try {
      if (!wallet) {
        setCreateMsg({ kind: "err", text: "Connect wallet first" });
        return false;
      }

      const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
      if (!eth?.request) {
        setCreateMsg({ kind: "err", text: "Wallet not detected. Reconnect." });
        return false;
      }

      await ensureConnected(eth);

      const ok = await ensureArcNetwork(eth);
      if (!ok) {
        setCreateMsg({ kind: "err", text: `Switch to Arc Testnet (${ARC_CHAIN_ID}).` });
        return false;
      }

      const o1 = normAddr(owner1);
      const o2 = normAddr(owner2);
      const o3 = normAddr(owner3);

      if (!o1 || !o2 || !o3) {
        setCreateMsg({ kind: "err", text: "Invalid owner address" });
        return false;
      }

      const uniq = new Set([o1.toLowerCase(), o2.toLowerCase(), o3.toLowerCase()]);
      if (uniq.size !== 3) {
        setCreateMsg({ kind: "err", text: "Owners must be 3 different addresses" });
        return false;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const w = await s2.getAddress();

      setProvider(p2);
      setSigner(s2);
      setWallet(w);

      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, s2);

      let predicted: string | null = null;
      try {
        predicted = await factory.createSave.staticCall([o1, o2, o3]);
        predicted = normAddr(predicted) || null;
      } catch {}

      const tx = await factory.createSave([o1, o2, o3]);
      const rc = await tx.wait();

      let created: string | null = null;
      try {
        const iface = new ethers.Interface(FACTORY_ABI);
        const topic0 = ethers.id("SaveCreated(address,address[3])");
        const logs = Array.isArray(rc?.logs) ? rc.logs : [];
        for (const lg of logs) {
          const addr = (lg?.address || "").toLowerCase();
          if (addr !== FACTORY_ADDRESS.toLowerCase()) continue;
          if (!lg?.topics || !lg.topics.length) continue;
          if (lg.topics[0] !== topic0) continue;
          try {
            const parsed = iface.parseLog(lg);
            const save = normAddr(parsed?.args?.save);
            if (save) {
              created = save;
              break;
            }
          } catch {}
        }
      } catch {}

      const safe = created || predicted;
      if (!safe) {
        setCreateMsg({ kind: "ok", text: "Safe created", hash: tx.hash });
        setCreateSafeOpen(false);
        setCreateStep(0);
        return true;
      }

      addSafeForWallet(w, safe);

      const nm = (newSafeName || "").trim();
      if (nm) setStoredName(safe, nm);

      setCreatedSafes(getSafesForWallet(w));

      setCreateMsg({ kind: "ok", text: "Safe created", hash: tx.hash });

      setCreateSafeOpen(false);
      setCreateStep(0);
      setNewSafeName("");
      setOwner1("");
      setOwner2("");
      setOwner3("");

      setSafeAddress(safe);
      await loadSafe(safe, { provider: p2, signer: s2 }, w);

      return true;
    } catch (e) {
      setCreateMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setPending((x) => ({ ...x, createSafe: false }));
    }
  }

  async function createTx() {
    setTxMsg(null);
    setPending((x) => ({ ...x, createTx: true }));
    try {
      if (!wallet || !signer) {
        setTxMsg({ kind: "err", text: "Connect wallet first" });
        return false;
      }
      if (!loadedSafe) {
        setTxMsg({ kind: "err", text: "Open a Safe first" });
        return false;
      }
      if (access !== "owner") {
        setTxMsg({ kind: "err", text: "Access denied" });
        return false;
      }

      const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
      if (!eth?.request) {
        setTxMsg({ kind: "err", text: "Wallet not detected. Reconnect." });
        return false;
      }

      await ensureConnected(eth);

      const ok = await ensureArcNetwork(eth);
      if (!ok) {
        setTxMsg({ kind: "err", text: `Switch to Arc Testnet (${ARC_CHAIN_ID}).` });
        return false;
      }

      const to = normAddr(txTo);
      if (!to) {
        setTxMsg({ kind: "err", text: "Invalid recipient address" });
        return false;
      }
      if (!txAmount) {
        setTxMsg({ kind: "err", text: "Enter amount" });
        return false;
      }

      const value = ethers.parseUnits(txAmount.trim(), NATIVE_DECIMALS);
      if (value <= 0n) {
        setTxMsg({ kind: "err", text: "Amount must be > 0" });
        return false;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const safe = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

      let predictedId: any = null;
      try {
        predictedId = await safe.createTx.staticCall(to, value);
      } catch {}

      const tx = await safe.createTx(to, value);
      await tx.wait();

      if (predictedId !== null && predictedId !== undefined) {
        const idNum = Number(predictedId);
        if (Number.isFinite(idNum) && idNum >= 0) {
          setStoredTxHash(loadedSafe, idNum, tx.hash);
          setTxHashes((m) => ({ ...m, [idNum]: tx.hash }));
        }
      }

      setTxTo("");
      setTxAmount("");

      setTxMsg({ kind: "ok", text: "Transaction created", hash: tx.hash });
      await loadSafe(loadedSafe);

      setTransferOpen(false);
      return true;
    } catch (e) {
      setTxMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setPending((x) => ({ ...x, createTx: false }));
    }
  }

  async function confirmTx(id: number) {
    setTxMsg(null);
    setPending((x) => ({ ...x, txAction: { id, action: "confirm" } }));
    try {
      if (!wallet || !signer) {
        setTxMsg({ kind: "err", text: "Connect wallet first" });
        return;
      }
      if (!loadedSafe) {
        setTxMsg({ kind: "err", text: "Safe is not open" });
        return;
      }
      if (access !== "owner") {
        setTxMsg({ kind: "err", text: "Access denied" });
        return;
      }

      const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
      if (!eth?.request) {
        setTxMsg({ kind: "err", text: "Wallet not detected. Reconnect." });
        return;
      }

      await ensureConnected(eth);

      const ok = await ensureArcNetwork(eth);
      if (!ok) {
        setTxMsg({ kind: "err", text: `Switch to Arc Testnet (${ARC_CHAIN_ID}).` });
        return;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const safe = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

      const tx = await safe.confirmTx(id);
      await tx.wait();

      setStoredTxHash(loadedSafe, id, tx.hash);
      setTxHashes((m) => ({ ...m, [id]: tx.hash }));

      setTxMsg({ kind: "ok", text: `TX ${id} confirmed`, hash: tx.hash });
      await loadSafe(loadedSafe);
    } catch (e) {
      setTxMsg({ kind: "err", text: errText(e) });
    } finally {
      setPending((x) => ({ ...x, txAction: null }));
    }
  }

  async function executeTx(id: number) {
    setTxMsg(null);
    setPending((x) => ({ ...x, txAction: { id, action: "execute" } }));
    try {
      if (!wallet || !signer) {
        setTxMsg({ kind: "err", text: "Connect wallet first" });
        return;
      }
      if (!loadedSafe) {
        setTxMsg({ kind: "err", text: "Safe is not open" });
        return;
      }
      if (access !== "owner") {
        setTxMsg({ kind: "err", text: "Access denied" });
        return;
      }

      const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
      if (!eth?.request) {
        setTxMsg({ kind: "err", text: "Wallet not detected. Reconnect." });
        return;
      }

      await ensureConnected(eth);

      const ok = await ensureArcNetwork(eth);
      if (!ok) {
        setTxMsg({ kind: "err", text: `Switch to Arc Testnet (${ARC_CHAIN_ID}).` });
        return;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const safe = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

      const tx = await safe.executeTx(id);
      await tx.wait();

      setStoredTxHash(loadedSafe, id, tx.hash);
      setTxHashes((m) => ({ ...m, [id]: tx.hash }));

      setTxMsg({ kind: "ok", text: `TX ${id} executed`, hash: tx.hash });
      await loadSafe(loadedSafe);
    } catch (e) {
      setTxMsg({ kind: "err", text: errText(e) });
    } finally {
      setPending((x) => ({ ...x, txAction: null }));
    }
  }

  const isLoaded = !!loadedSafe;
  const wrongNet = wallet && chainId && !isArc(chainId);

  const canView = access === "owner";
  const denied = access === "denied";

  const safeTitle = useMemo(() => {
    if (!isLoaded || !canView) return "";
    const n = (getStoredName(loadedSafe) || "").trim();
    return n || "Unnamed Safe";
  }, [isLoaded, loadedSafe, canView]);

  const filteredSafes = useMemo(() => {
    const q = (safeSearch || "").trim().toLowerCase();
    if (!q) return createdSafes;
    return createdSafes.filter((a) => {
      const n = (getStoredName(a) || "").toLowerCase();
      return a.toLowerCase().includes(q) || n.includes(q);
    });
  }, [createdSafes, safeSearch]);

  const chipStyle: CSSProperties = {
    minWidth: 120,
    textAlign: "center",
  };

  const headerNetBadge = useMemo(() => {
    if (!wallet) return null;
    if (wrongNet)
      return (
        <span className="chip chipErr" style={chipStyle}>
          Wrong network
        </span>
      );
    return (
      <span className="chip chipOk" style={chipStyle}>
        Arc Testnet
      </span>
    );
  }, [wallet, wrongNet]);

  const accessBadge = useMemo(() => {
    if (!isLoaded) return null;
    if (loadingSafe || access === "checking")
      return (
        <span className="chip" style={chipStyle}>
          Loading…
        </span>
      );
    if (canView)
      return (
        <span className="chip chipOk" style={chipStyle}>
          Owner #{ownerIndex + 1}
        </span>
      );
    if (denied)
      return (
        <span className="chip chipErr" style={chipStyle}>
          Access denied
        </span>
      );
    return null;
  }, [isLoaded, loadingSafe, access, canView, ownerIndex, denied]);

  const copyTipStyle: CSSProperties = {
    position: "absolute",
    left: "calc(100% + 10px)",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 40,
    padding: "9px 12px",
    borderRadius: 14,
    border: "1px solid rgba(120, 170, 255, 0.18)",
    background: "radial-gradient(120% 120% at 20% 10%, rgba(64, 120, 255, 0.22), rgba(6, 10, 22, 0.95))",
    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    lineHeight: 1.25,
    letterSpacing: "-0.01em",
    textAlign: "center",
    width: 230,
    maxWidth: "min(230px, calc(100vw - 36px))",
    pointerEvents: "none",
  };

  const copyTipArrowStyle: CSSProperties = {
    position: "absolute",
    left: -6,
    top: "50%",
    transform: "translateY(-50%) rotate(45deg)",
    width: 12,
    height: 12,
    background: "rgba(6, 10, 22, 0.95)",
    borderLeft: "1px solid rgba(120, 170, 255, 0.18)",
    borderBottom: "1px solid rgba(120, 170, 255, 0.18)",
  };

  const fortBrandStyle: CSSProperties = {
    display: "inline-block",
    fontSize: 30,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: "-0.03em",
    paddingBottom: "0.10em",
    background:
      "linear-gradient(180deg,#ffffff 0%,#f3f8ff 16%,#ffffff 40%,#d4e2ff 62%,#ffffff 84%,#f7fbff 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
    WebkitTextStroke: "1px rgba(0,0,0,0.16)",
    textShadow: "0 1px 0 rgba(255,255,255,0.30), 0 10px 22px rgba(0,0,0,0.48), 0 22px 56px rgba(0,0,0,0.36)",
  };

  const headerStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 10,
    padding: 0,
    background: "linear-gradient(180deg, rgba(6,10,20,0.70) 0%, rgba(6,10,20,0.10) 100%)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  return (
    <div className={styles.wrap} style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <WalletConnectModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onSelect={async (eth: any, key: string) => {
          return await connectSelected(eth, key);
        }}
      />

      <PortalModal
        open={transferOpen}
        title="New transfer"
        onClose={() => setTransferOpen(false)}
        width="min(560px, calc(100vw - 36px))"
        showClose={false}
      >
        <div className="stackSm" style={{ padding: 2 }}>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Recipient
          </div>
          <input
            placeholder="0x..."
            value={txTo}
            onChange={(e) => setTxTo(e.target.value)}
            onBlur={(e) => setTxTo(e.target.value.trim())}
          />

          <div className="muted" style={{ fontSize: 12 }}>
            Amount ({NATIVE_SYMBOL})
          </div>
          <input
            placeholder="0.0"
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value)}
            onBlur={(e) => setTxAmount(e.target.value.trim())}
          />

          <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <button className="btn btnOk" onClick={createTx} disabled={pending.createTx} type="button">
              {pending.createTx ? "Submitting…" : "Create"}
            </button>
            <button className="btn" onClick={() => setTransferOpen(false)} type="button">
              Cancel
            </button>
          </div>

          <Msg m={txMsg} />
        </div>
      </PortalModal>

      <PortalModal
        open={createSafeOpen}
        title="Create new safe"
        onClose={() => setCreateSafeOpen(false)}
        width="min(620px, calc(100vw - 36px))"
      >
        <div className="stackSm" style={{ padding: 2 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Step {createStep + 1} / 2
          </div>

          {createStep === 0 ? (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Name
              </div>
              <input
                placeholder="My Fort"
                value={newSafeName}
                onChange={(e) => setNewSafeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setCreateStep(1);
                }}
              />
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={() => setCreateStep(1)} type="button">
                  Next
                </button>
              </div>
              <Msg m={createMsg} />
            </>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Owners (3)
              </div>
              <input
                placeholder="Owner 1"
                value={owner1}
                onChange={(e) => setOwner1(e.target.value)}
                onBlur={(e) => setOwner1(e.target.value.trim())}
              />
              <input
                placeholder="Owner 2"
                value={owner2}
                onChange={(e) => setOwner2(e.target.value)}
                onBlur={(e) => setOwner2(e.target.value.trim())}
              />
              <input
                placeholder="Owner 3"
                value={owner3}
                onChange={(e) => setOwner3(e.target.value)}
                onBlur={(e) => setOwner3(e.target.value.trim())}
              />

              <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                <button className="btn btnOk" onClick={createSafe} disabled={pending.createSafe} type="button">
                  {pending.createSafe ? "Creating…" : "Create"}
                </button>
                <button className="btn" onClick={() => setCreateStep(0)} disabled={pending.createSafe} type="button">
                  Back
                </button>
              </div>

              <Msg m={createMsg} />
            </>
          )}
        </div>
      </PortalModal>

      <PortalModal
        open={renameOpen}
        title="Rename safe"
        onClose={() => {
          setRenameOpen(false);
          setRenameAddr("");
          setRenameValue("");
        }}
        width="min(360px, calc(100vw - 36px))"
        showClose={false}
      >
        <div className="stackSm" style={{ padding: 2 }}>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Name
          </div>
          <input
            placeholder="Unnamed Safe"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={(e) => setRenameValue(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const a = normAddr(renameAddr);
                if (!a) return;
                const v = (renameValue || "").trim();
                setStoredName(a, v);
                setRenameOpen(false);
                setRenameAddr("");
                setRenameValue("");
              }
            }}
          />
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <button
              className="btn"
              onClick={() => {
                const a = normAddr(renameAddr);
                if (!a) return;
                const v = (renameValue || "").trim();
                setStoredName(a, v);
                setRenameOpen(false);
                setRenameAddr("");
                setRenameValue("");
              }}
              type="button"
            >
              Save
            </button>
            <button
              className="btn"
              onClick={() => {
                setRenameOpen(false);
                setRenameAddr("");
                setRenameValue("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </PortalModal>

      <PortalModal
        open={removeOpen}
        title="Remove safe"
        onClose={() => {
          setRemoveOpen(false);
          setRemoveAddr("");
        }}
        width="min(360px, calc(100vw - 36px))"
        showClose={false}
      >
        <div className="stackSm" style={{ padding: 2 }}>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <button
              className="btn"
              onClick={() => {
                if (!wallet) return;
                const a = normAddr(removeAddr);
                if (!a) return;
                removeSafeForWallet(wallet, a);
                setRemoveOpen(false);
                setRemoveAddr("");
              }}
              type="button"
              style={{
                border: "1px solid rgba(255, 95, 115, 0.45)",
                background: "rgba(255, 95, 115, 0.12)",
              }}
            >
              Remove
            </button>
            <button
              className="btn"
              onClick={() => {
                setRemoveOpen(false);
                setRemoveAddr("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </PortalModal>

      <header className={styles.header} style={headerStyle}>
        <div
          className="container"
          style={{
            maxWidth: 1320,
            width: "100%",
            padding: "18px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
          }}
        >
          <a
            href="/"
            aria-label="Go to FORT landing"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/");
            }}
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              opacity: 1,
              filter: "none",
              transform: "translateY(0px)",
            }}
          >
            <span style={fortBrandStyle}>FORT</span>
          </a>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {headerNetBadge}
            <WalletMenu
              wallet={wallet}
              connecting={pending.connect}
              onConnect={() => {
                setWalletMsg(null);
                setWalletModalOpen(true);
              }}
              onDisconnect={disconnectWallet}
            />
          </div>
        </div>
      </header>

      <main className={styles.main} style={{ flex: "1 1 auto" }}>
        <div className="container stack" style={{ maxWidth: 1320, width: "100%" }}>
          <Msg m={walletMsg} />

          {wrongNet ? (
            <div className="banner bannerErr">
              <div>
                Wrong network. Switch to Arc Testnet ({ARC_CHAIN_ID}). Detected: {chainId}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
                      if (!eth?.request) {
                        setWalletMsg({ kind: "err", text: "Connect wallet first" });
                        return;
                      }
                      await ensureConnected(eth);
                      const ok = await ensureArcNetwork(eth);
                      if (ok && loadedSafe) await loadSafe(loadedSafe);
                    } catch (e) {
                      setWalletMsg({ kind: "err", text: errText(e) });
                    }
                  }}
                  disabled={pending.switchNet}
                  type="button"
                >
                  {pending.switchNet ? "Switching…" : "Switch network"}
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
            <div
              className="card"
              style={{
                width: 420,
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 22 }}>My Safes</h2>
              </div>

              <div
                className="stackSm"
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  flex: "1 1 auto",
                  minHeight: 0,
                }}
              >
                <input
                  placeholder="Search by name or address"
                  value={safeSearch}
                  onChange={(e) => setSafeSearch(e.target.value)}
                />

                <div
                  className="stackSm"
                  style={{
                    flex: "1 1 auto",
                    minHeight: wallet ? 240 : 0,
                    overflow: rowMenuOpenFor ? "visible" : "auto",
                    paddingRight: 4,
                    paddingBottom: 140,
                  }}
                >
                  {!wallet ? (
                    <div className="muted">Connect wallet to see your safes</div>
                  ) : filteredSafes.length === 0 ? (
                    <div className="muted">No safes yet</div>
                  ) : (
                    filteredSafes.map((a, idx) => {
                      const n = (getStoredName(a) || "").trim();
                      const active = loadedSafe && a.toLowerCase() === loadedSafe.toLowerCase();

                      const openUp =
                        filteredSafes.length >= 6
                          ? idx >= filteredSafes.length - 2
                          : filteredSafes.length >= 3
                          ? idx === filteredSafes.length - 1
                          : false;

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
                        width: 180,
                        borderRadius: 14,
                        background:
                          "radial-gradient(120% 120% at 20% 10%, rgba(64, 120, 255, 0.22), rgba(6, 10, 22, 0.95))",
                        border: "1px solid rgba(120, 170, 255, 0.18)",
                        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
                        overflow: "hidden",
                      };

                      const menuWrapStyle: CSSProperties = openUp ? { ...menuBaseStyle, bottom: 44 } : { ...menuBaseStyle, top: 44 };

                      const menuBtnStyle: CSSProperties = {
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 12px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "rgba(255,255,255,0.92)",
                        fontSize: 13,
                        textAlign: "left",
                        outline: "none",
                        boxShadow: "none",
                        appearance: "none",
                        WebkitAppearance: "none",
                      };

                      return (
                        <div key={a} style={{ position: "relative" }} data-rowmenu>
                          <div style={wrapStyle}>
                            <button
                              type="button"
                              style={selectBtnStyle}
                              onClick={() => {
                                setSafeAddress(a);
                                loadSafe(a);
                              }}
                            >
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
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
                                    <span style={{ opacity: 0.98 }}>{n || "Unnamed Safe"}</span>
                                    <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                                      {short(a)}
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
                                setRowMenuOpenFor((cur) => (cur && cur.toLowerCase() === a.toLowerCase() ? "" : a));
                              }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="12" cy="5" r="2.2" fill="rgba(255,255,255,0.85)" />
                                <circle cx="12" cy="12" r="2.2" fill="rgba(255,255,255,0.85)" />
                                <circle cx="12" cy="19" r="2.2" fill="rgba(255,255,255,0.85)" />
                              </svg>
                            </button>
                          </div>

                          {rowMenuOpenFor && rowMenuOpenFor.toLowerCase() === a.toLowerCase() ? (
                            <div style={menuWrapStyle}>
                              <button
                                type="button"
                                style={menuBtnStyle}
                                onClick={() => {
                                  setRowMenuOpenFor("");
                                  setRenameAddr(a);
                                  setRenameValue((getStoredName(a) || "").trim());
                                  setRenameOpen(true);
                                }}
                              >
                                <span style={{ width: 18, display: "inline-flex", justifyContent: "center" }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4.5a2.1 2.1 0 0 0-3 0L3 15v5z"
                                      fill="none"
                                      stroke="rgba(80,220,170,0.95)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </span>
                                Rename
                              </button>

                              <div style={{ height: 1, background: "rgba(120,170,255,0.12)" }} />

                              <button
                                type="button"
                                style={menuBtnStyle}
                                onClick={() => {
                                  setRowMenuOpenFor("");
                                  setRemoveAddr(a);
                                  setRemoveOpen(true);
                                }}
                              >
                                <span style={{ width: 18, display: "inline-flex", justifyContent: "center" }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 6h18" fill="none" stroke="rgba(255,95,115,0.95)" strokeWidth="2" strokeLinecap="round" />
                                    <path
                                      d="M8 6V4h8v2"
                                      fill="none"
                                      stroke="rgba(255,95,115,0.95)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M6 6l1 16h10l1-16"
                                      fill="none"
                                      stroke="rgba(255,95,115,0.95)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path d="M10 11v6M14 11v6" fill="none" stroke="rgba(255,95,115,0.95)" strokeWidth="2" strokeLinecap="round" />
                                  </svg>
                                </span>
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setCreateMsg(null);
                      setCreateStep(0);
                      setNewSafeName("");
                      setOwner1("");
                      setOwner2("");
                      setOwner3("");
                      setCreateSafeOpen(true);
                    }}
                    type="button"
                  >
                    Create new safe
                  </button>
                </div>

                <div style={{ height: 14 }} />

                <div className="muted" style={{ fontSize: 12 }}>
                  Import safe
                </div>
                <div className="row">
                  <input
                    className="grow"
                    placeholder="0x..."
                    value={importAddr}
                    onChange={(e) => setImportAddr(e.target.value)}
                    onBlur={(e) => setImportAddr(e.target.value.trim())}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      const a = normAddr(importAddr);
                      if (!a) {
                        setWalletMsg({ kind: "err", text: "Invalid safe address" });
                        return;
                      }
                      setSafeAddress(a);
                      loadSafe(a);
                      setImportAddr("");
                    }}
                    type="button"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>

            <div style={{ flex: "1 1 auto", minWidth: 0 }} className="stack">
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                      <h2 style={{ margin: 0, fontSize: 22, flex: "0 0 auto" }}>Safe</h2>
                      {isLoaded && canView ? (
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 820,
                            maxWidth: "min(620px, 100%)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            opacity: 0.98,
                          }}
                        >
                          {safeTitle}
                        </div>
                      ) : null}
                    </div>

                    <div className="muted" style={{ marginTop: 10 }}>
                      {isLoaded ? (
                        canView ? (
                          <span
                            title="Click to copy"
                            onClick={() => copySafe(loadedSafe)}
                            style={{ cursor: "pointer", userSelect: "none" }}
                          >
                            {loadedSafe}
                          </span>
                        ) : wallet ? (
                          "Restricted"
                        ) : (
                          "Connect wallet to view"
                        )
                      ) : (
                        "Select a safe from the list"
                      )}
                    </div>

                    {safeErr ? (
                      <div className="err" style={{ marginTop: 10, fontSize: 13 }}>
                        {safeErr}
                      </div>
                    ) : null}
                  </div>

                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    {accessBadge}
                  </div>
                </div>

                {isLoaded && canView ? (
                  <div className="row" style={{ marginTop: 14, justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <div style={{ position: "relative", display: "inline-flex" }}>
                        <IconBtn
                          onClick={copySafeLink}
                          onMouseEnter={() => setCopyTipOpen(true)}
                          onMouseLeave={() => setCopyTipOpen(false)}
                          onFocus={() => setCopyTipOpen(true)}
                          onBlur={() => setCopyTipOpen(false)}
                        >
                          Copy link
                        </IconBtn>
                        {copyTipOpen ? (
                          <div style={copyTipStyle}>
                            open and sign from other device
                            <div style={copyTipArrowStyle} />
                          </div>
                        ) : null}
                      </div>

                      {copiedLink ? <span className="chip chipOk">Copied</span> : null}
                      {copiedSafe === loadedSafe && loadedSafe ? <span className="chip chipOk">Copied</span> : null}
                    </div>

                    <button
                      className="btn btnOk"
                      onClick={() => setTransferOpen(true)}
                      disabled={!canView}
                      type="button"
                      title={!canView ? "Open a safe as owner to create transfers" : "Create a new transfer"}
                    >
                      New transfer
                    </button>
                  </div>
                ) : null}
              </div>

              {isLoaded ? (
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "stretch" }}>
                  <div className="card" style={{ flex: "1 1 520px", minWidth: 0 }}>
                    {!canView ? (
                      <div className="muted">Open as owner to view assets</div>
                    ) : (
                      <div className="stackSm">
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
                              Balance
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 780 }}>
                              {balance} {NATIVE_SYMBOL}
                            </div>
                          </div>
                        </div>

                        <details style={{ marginTop: 10 }}>
                          <summary style={{ cursor: "pointer", userSelect: "none" }}>Owners (3)</summary>
                          <div className="stackSm" style={{ marginTop: 12 }}>
                            {owners.map((o, i) => {
                              const isMe = wallet && wallet.toLowerCase() === o.toLowerCase();
                              const isCopied = copiedOwner === o;
                              return (
                                <div
                                  key={i}
                                  className="row ownerRow"
                                  role="button"
                                  tabIndex={0}
                                  title="Click to copy"
                                  onClick={() => {
                                    try {
                                      navigator.clipboard.writeText(o);
                                      setCopiedOwner(o);
                                      setTimeout(() => setCopiedOwner(""), 900);
                                    } catch {}
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      try {
                                        navigator.clipboard.writeText(o);
                                        setCopiedOwner(o);
                                        setTimeout(() => setCopiedOwner(""), 900);
                                      } catch {}
                                    }
                                  }}
                                  style={{ userSelect: "none" }}
                                >
                                  <span className={isMe ? "ok" : ""}>{o}</span>
                                  <span className="muted" style={{ fontSize: 12 }}>
                                    {isCopied ? "Copied" : "Copy"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      </div>
                    )}
                  </div>

                  <div className="card" style={{ flex: "1 1 520px", minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
                      Transactions
                    </div>

                    <Msg m={txMsg} />

                    {!canView ? (
                      <div className="muted">Open as owner to view transactions</div>
                    ) : txs.length === 0 ? (
                      <div className="muted">No transactions</div>
                    ) : (
                      <div className="stackSm" style={{ maxHeight: 520, overflow: "auto", paddingRight: 4 }}>
                        {txs.map((t) => {
                          const txAction = pending.txAction;
                          const isConfirming = txAction?.id === t.id && txAction?.action === "confirm";
                          const isExecuting = txAction?.id === t.id && txAction?.action === "execute";
                          const disableRow = !!txAction;

                          const h = txHashes?.[t.id] || "";
                          const u = h ? txUrl(h) : "";

                          const sigs = txConfirmedByOwner?.[t.id] || [];
                          const meConfirmed = ownerIndex >= 0 ? !!sigs[ownerIndex] : false;

                          const status = t.executed
                            ? "Executed"
                            : t.confirms >= THRESHOLD
                            ? "Ready to execute"
                            : `Waiting for confirmations (${Math.max(0, t.confirms)}/${THRESHOLD})`;

                          return (
                            <div key={t.id} className="txItem">
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 780 }}>
                                    TX #{t.id}{" "}
                                    <span className="muted" style={{ fontWeight: 600 }}>
                                      • {status}
                                    </span>
                                  </div>
                                  <div
                                    className="muted"
                                    style={{
                                      fontSize: 12,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    to {short(t.to)} • {ethers.formatUnits(t.amount, NATIVE_DECIMALS)} {NATIVE_SYMBOL} • signatures{" "}
                                    {t.confirms}/{THRESHOLD}
                                  </div>

                                  <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                    {owners.map((o, i) => {
                                      const ok = !!sigs[i];
                                      const me = i === ownerIndex;
                                      const cls = ok ? "chip chipOk" : "chip";
                                      return (
                                        <span
                                          key={i}
                                          className={cls}
                                          style={{
                                            minWidth: 0,
                                            textAlign: "center",
                                            padding: "6px 10px",
                                            fontSize: 12,
                                            opacity: ok ? 1 : 0.7,
                                          }}
                                          title={o}
                                        >
                                          {me ? "You" : `Owner ${i + 1}`}
                                          {ok ? " ✓" : ""}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
                                  {u ? (
                                    <a href={u} target="_blank" rel="noopener noreferrer" style={{ opacity: 0.85, fontSize: 12 }}>
                                      View in Explorer
                                    </a>
                                  ) : null}
                                  {!t.executed ? (
                                    <>
                                      <button
                                        className="btn"
                                        onClick={() => confirmTx(t.id)}
                                        disabled={disableRow || meConfirmed}
                                        type="button"
                                        title={meConfirmed ? "Already confirmed by this wallet" : "Confirm"}
                                      >
                                        {meConfirmed ? "Confirmed" : isConfirming ? "Confirming…" : "Confirm"}
                                      </button>
                                      {t.confirms >= THRESHOLD ? (
                                        <button className="btn btnOk" onClick={() => executeTx(t.id)} disabled={disableRow} type="button">
                                          {isExecuting ? "Executing…" : "Execute"}
                                        </button>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      <footer className="footer" style={{ marginTop: "auto" }}>
        <div className="container" style={{ maxWidth: 1320, width: "100%", padding: "0 24px", margin: "0 auto", boxSizing: "border-box" }}>
          <div className="footerBar">
            <div className="footerText">2025 · FORT · Built on Arc Network · All rights reserved.</div>
            <a
              className="footerX"
              href="https://x.com/Gioddddd"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X"
              title="X"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.4-8.4L1 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L7.5 3.9H5.7L17.8 20Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
