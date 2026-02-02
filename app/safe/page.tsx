"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ethers } from "ethers";
import styles from "./page.module.css";
import WalletMenu from "../../components/WalletMenu";
import WalletConnectModal from "../../components/WalletConnectModal";

const FACTORY_ADDRESS_RAW = "0x264e2d5537b0073f35ed6a0ed006eb21022985c7";
const FACTORY_ADDRESS = ethers.getAddress(FACTORY_ADDRESS_RAW);
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
  "function getSafesForOwner(address owner) view returns (address[])",
  "function getSafeName(address safe) view returns (string)",
  "function setSafeName(address safe, string name)",
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
const HIDDEN_SAFES_PREFIX = "arcsafe:hiddenSafes:";
const CONNECTED_WALLET_KEY = "arcsafe:connectedWallet";

const FACTORY_FROM_BLOCK = Number(process.env.NEXT_PUBLIC_FACTORY_FROM_BLOCK || 0);
const LOG_CHUNK = Number(process.env.NEXT_PUBLIC_FACTORY_LOG_CHUNK || 35000);

function normAddr(x: string) {
  const a = (x || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return null;
  try {
    return ethers.getAddress(a);
  } catch {
    return null;
  }
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

function getHiddenSafes(wallet: string): string[] {
  try {
    const w = (wallet || "").toLowerCase();
    if (!w) return [];
    const raw = localStorage.getItem(HIDDEN_SAFES_PREFIX + w);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x: string) => x.toLowerCase()) : [];
  } catch {
    return [];
  }
}

function hideSafe(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;
    const hidden = getHiddenSafes(wallet);
    if (!hidden.includes(s.toLowerCase())) {
      hidden.push(s.toLowerCase());
      localStorage.setItem(HIDDEN_SAFES_PREFIX + w, JSON.stringify(hidden));
    }
  } catch {}
}

function unhideSafe(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;
    const hidden = getHiddenSafes(wallet);
    const next = hidden.filter((x) => x !== s.toLowerCase());
    localStorage.setItem(HIDDEN_SAFES_PREFIX + w, JSON.stringify(next));
  } catch {}
}

function isSafeHidden(wallet: string, safe: string): boolean {
  const s = normAddr(safe);
  if (!s) return false;
  return getHiddenSafes(wallet).includes(s.toLowerCase());
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
  const [safeNames, setSafeNames] = useState<Record<string, string>>({});

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
    rename: false,
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
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  useEffect(() => {
    const tryAutoConnect = async () => {
      try {
        const savedKey = localStorage.getItem(CONNECTED_WALLET_KEY);
        if (!savedKey) return;

        const eth = (window as any).ethereum;
        if (!eth) return;

        const providers = Array.isArray(eth?.providers) && eth.providers.length ? eth.providers : eth ? [eth] : [];
        
        let targetEth = null;
        for (const p of providers) {
          const name = p?.isMetaMask ? "metamask" : p?.isRabby ? "rabby" : p?.isCoinbaseWallet ? "coinbase" : "";
          if (name === savedKey || (savedKey === "injected" && providers.length === 1)) {
            targetEth = p;
            break;
          }
        }
        
        if (!targetEth && providers.length === 1) {
          targetEth = providers[0];
        }

        if (targetEth) {
          const accounts = await targetEth.request({ method: "eth_accounts" });
          if (accounts && accounts.length > 0) {
            await connectSelected(targetEth, savedKey);
          }
        }
      } catch (e) {
        console.log("Auto-connect error:", e);
      }
    };

    const timer = setTimeout(tryAutoConnect, 300);
    return () => clearTimeout(timer);
  }, []);

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

  async function fetchSafeName(safeAddr: string): Promise<string> {
    try {
      const iface = new ethers.Interface(FACTORY_ABI);
      const calldata = iface.encodeFunctionData("getSafeName", [safeAddr]);
      const response = await fetch(ARC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to: FACTORY_ADDRESS, data: calldata }, "latest"],
          id: 1,
        }),
      });
      const json = await response.json();
      if (json.error) return "";
      const decoded = iface.decodeFunctionResult("getSafeName", json.result);
      return decoded[0] || "";
    } catch {
      return "";
    }
  }

  async function saveSafeNameOnChain(safeAddr: string, name: string) {
    const a = normAddr(safeAddr);
    if (!a || !signer) return false;
    
    setPending((x) => ({ ...x, rename: true }));
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      const tx = await factory.setSafeName(a, name);
      await tx.wait();
      setSafeNames((prev) => ({ ...prev, [a.toLowerCase()]: name }));
      return true;
    } catch (e) {
      console.log("saveSafeNameOnChain error:", e);
      return false;
    } finally {
      setPending((x) => ({ ...x, rename: false }));
    }
  }

  async function syncSafesFromChain(walletAddr: string, p: any) {
    console.log("syncSafesFromChain called", walletAddr);
    const w = normAddr(walletAddr);
    if (!w) {
      console.log("syncSafesFromChain: invalid wallet");
      return;
    }

    setPending((x) => ({ ...x, syncSafes: true }));
    try {
      console.log("syncSafesFromChain: FACTORY_ADDRESS =", FACTORY_ADDRESS);
      console.log("syncSafesFromChain: wallet =", w);
      
      const iface = new ethers.Interface(FACTORY_ABI);
      const calldata = iface.encodeFunctionData("getSafesForOwner", [w]);
      console.log("syncSafesFromChain: calldata =", calldata);
      
      const response = await fetch(ARC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to: FACTORY_ADDRESS, data: calldata }, "latest"],
          id: 1,
        }),
      });
      const json = await response.json();
      console.log("syncSafesFromChain: raw response =", json);
      
      if (json.error) {
        throw new Error(json.error.message || "RPC error");
      }
      
      const decoded = iface.decodeFunctionResult("getSafesForOwner", json.result);
      const safes: string[] = decoded[0];
      console.log("syncSafesFromChain: got safes", safes);
      
      for (const safe of safes) {
        const addr = normAddr(safe);
        if (addr) addSafeForWallet(w, addr);
      }
      
      setCreatedSafes(getSafesForWallet(w));

      const names: Record<string, string> = {};
      for (const safe of safes) {
        const addr = normAddr(safe);
        if (addr) {
          const name = await fetchSafeName(addr);
          if (name) names[addr.toLowerCase()] = name;
        }
      }
      setSafeNames((prev) => ({ ...prev, ...names }));
    } catch (e) {
      console.log("syncSafesFromChain error:", e);
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

      try {
        localStorage.setItem(CONNECTED_WALLET_KEY, key);
      } catch {}

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
    try {
      localStorage.removeItem(CONNECTED_WALLET_KEY);
    } catch {}
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
      } catch {} finally {
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

      const n = (safeNames[loadedSafe.toLowerCase()] || "").trim();
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
      const a = normAddr(s);
      if (a) {
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

      const reader: any = new ethers.Contract(a, SAFE_ABI, p);

      let ownersArr: string[] = [];
      try {
        const from = ethers.getAddress(activeWallet);
        const a0 = await reader.owners(0, { from });
        const a1 = await reader.owners(1, { from });
        const a2 = await reader.owners(2, { from });
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

      if (!safeNames[a.toLowerCase()]) {
        fetchSafeName(a).then((name) => {
          if (name) setSafeNames((prev) => ({ ...prev, [a.toLowerCase()]: name }));
        });
      }

      const n = (safeNames[a.toLowerCase()] || "").trim();
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
    console.log("createSafe called");
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

      console.log("owner1:", owner1);
      console.log("owner2:", owner2);
      console.log("owner3:", owner3);
      
      const o1 = normAddr(owner1);
      const o2 = normAddr(owner2);
      const o3 = normAddr(owner3);
      
      console.log("normalized:", o1, o2, o3);

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

      console.log("creating factory contract");
      const factory: any = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, s2);

      console.log("preparing owners array");
      const owners: [string, string, string] = [o1, o2, o3];
      console.log("owners array:", owners);

      let predicted: string | null = null;
      try {
        console.log("calling staticCall");
        predicted = await factory.createSave.staticCall(owners);
        predicted = normAddr(predicted ?? "") || null;
        console.log("predicted:", predicted);
      } catch (e) {
        console.log("staticCall error:", e);
      }

      console.log("calling createSave");
      const tx = await factory.createSave(owners);
      console.log("tx:", tx);
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

      let safe = created || predicted;
      
      if (!safe) {
        const iface2 = new ethers.Interface(FACTORY_ABI);
        const calldata2 = iface2.encodeFunctionData("getSafesForOwner", [w]);
        const resp2 = await fetch(ARC_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: FACTORY_ADDRESS, data: calldata2 }, "latest"],
            id: 1,
          }),
        });
        const json2 = await resp2.json();
        if (!json2.error && json2.result && json2.result !== "0x") {
          const decoded2 = iface2.decodeFunctionResult("getSafesForOwner", json2.result);
          const safes2: string[] = decoded2[0];
          if (safes2.length > 0) {
            safe = normAddr(safes2[safes2.length - 1]);
          }
        }
      }

      if (!safe) {
        setCreateMsg({ kind: "ok", text: "Safe created", hash: tx.hash });
        setCreateSafeOpen(false);
        setCreateStep(0);
        await syncSafesFromChain(w, p2);
        return true;
      }

      addSafeForWallet(w, safe);

      const nm = (newSafeName || "").trim();
      if (nm) {
        await saveSafeNameOnChain(safe, nm);
      }

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

      if (txAmount.includes(",")) {
        setTxMsg({ kind: "err", text: "Invalid value: use \".\" not \",\"" });
        return false;
      }

      let value: bigint;
      try {
        value = ethers.parseUnits(txAmount.trim(), NATIVE_DECIMALS);
      } catch {
        setTxMsg({ kind: "err", text: "Invalid amount format" });
        return false;
      }
      if (value <= 0n) {
        setTxMsg({ kind: "err", text: "Amount must be > 0" });
        return false;
      }

      const p2 = new ethers.BrowserProvider(eth);
      const s2 = await p2.getSigner();
      const safe: any = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

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
      const safe: any = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

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
      const safe: any = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

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
    const n = (safeNames[loadedSafe.toLowerCase()] || "").trim();
    return n || "Unnamed Safe";
  }, [isLoaded, loadedSafe, canView, safeNames]);

  const filteredSafes = useMemo(() => {
    const q = (safeSearch || "").trim().toLowerCase();
    let list = createdSafes;
    if (showHidden) {
      list = list.filter((a) => isSafeHidden(wallet, a));
    } else {
      list = list.filter((a) => !isSafeHidden(wallet, a));
    }
    if (!q) return list;
    return list.filter((a) => {
      const n = (safeNames[a.toLowerCase()] || "").toLowerCase();
      return a.toLowerCase().includes(q) || n.includes(q);
    });
  }, [createdSafes, safeSearch, safeNames, showHidden, wallet]);

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
        <span className="chip chipOk" style={chipStyle} title={wallet}>
          Owner {ownerIndex + 1}
        </span>
      );
    if (denied)
      return (
        <span className="chip chipErr" style={chipStyle}>
          Access denied
        </span>
      );
    return null;
  }, [isLoaded, loadingSafe, access, canView, ownerIndex, denied, wallet]);

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
          <div className="muted" style={{ fontSize: 12, marginTop: 10, textTransform: "uppercase" }}>
            Recipient
          </div>
          <input
            placeholder="0x..."
            value={txTo}
            onChange={(e) => setTxTo(e.target.value)}
            onBlur={(e) => setTxTo(e.target.value.trim())}
          />

          <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
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
              <div className="muted" style={{ fontSize: 12, marginTop: 10, textTransform: "uppercase" }}>
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
          if (pending.rename) return;
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
            disabled={pending.rename}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && !pending.rename) {
                const a = normAddr(renameAddr);
                if (!a) return;
                const v = (renameValue || "").trim();
                const ok = await saveSafeNameOnChain(a, v);
                if (ok) {
                  setRenameOpen(false);
                  setRenameAddr("");
                  setRenameValue("");
                }
              }
            }}
          />
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <button
              className="btn"
              onClick={async () => {
                const a = normAddr(renameAddr);
                if (!a) return;
                const v = (renameValue || "").trim();
                const ok = await saveSafeNameOnChain(a, v);
                if (ok) {
                  setRenameOpen(false);
                  setRenameAddr("");
                  setRenameValue("");
                }
              }}
              type="button"
              disabled={pending.rename}
            >
              {pending.rename ? "Saving..." : "Save"}
            </button>
            <button
              className="btn"
              onClick={() => {
                setRenameOpen(false);
                setRenameAddr("");
                setRenameValue("");
              }}
              type="button"
              disabled={pending.rename}
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
                <h2 style={{ margin: 0, fontSize: 22, textTransform: "uppercase" }}>My Safes</h2>
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
                      const n = (safeNames[a.toLowerCase()] || "").trim();
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

                      const menuBtnStyle: CSSProperties = {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 10,
                        background: "transparent",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        color: "rgba(255,255,255,0.8)",
                        outline: "none",
                        boxShadow: "none",
                        appearance: "none",
                        WebkitAppearance: "none",
                        transition: "background 0.15s ease",
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
                                setRowMenuOpenFor((cur) =>
                                  cur && cur.toLowerCase() === a.toLowerCase() ? "" : a
                                );
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
                                className="menuIconBtn"
                                onClick={() => {
                                  setRowMenuOpenFor("");
                                  setRenameAddr(a);
                                  setRenameValue((safeNames[a.toLowerCase()] || "").trim());
                                  setRenameOpen(true);
                                }}
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
                                onClick={() => {
                                  setRowMenuOpenFor("");
                                  if (isSafeHidden(wallet, a)) {
                                    unhideSafe(wallet, a);
                                  } else {
                                    hideSafe(wallet, a);
                                  }
                                  setCreatedSafes([...createdSafes]);
                                }}
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                  {isSafeHidden(wallet, a) ? (
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
                                <span className="menuIconLabel">{isSafeHidden(wallet, a) ? "Unhide" : "Hide"}</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="row" style={{ justifyContent: "space-between", marginTop: 6, gap: 8 }}>
                  <button
                    className="btn btnOk"
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
                  <button
                    className="btn"
                    onClick={() => setShowHidden(!showHidden)}
                    type="button"
                    style={{ opacity: showHidden ? 1 : 0.6 }}
                  >
                    {showHidden ? "Hidden" : "Show all"}
                  </button>
                </div>

                <div style={{ height: 14 }} />

                <div className="row">
                  <input
                    className="grow"
                    placeholder="Paste safe address"
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
                      <h2 style={{ margin: 0, fontSize: 22, flex: "0 0 auto", textTransform: "uppercase" }}>Safe</h2>
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

                    <div className="muted" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {isLoaded ? (
                        canView ? (
                          <>
                            <span style={{ wordBreak: "break-all" }}>
                              {loadedSafe}
                            </span>
                            <button
                              className="copyIconBtn"
                              onClick={() => copySafe(loadedSafe)}
                              type="button"
                            >
                              {copiedSafe === loadedSafe ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                              )}
                            </button>
                          </>
                        ) : wallet ? (
                          "Restricted"
                        ) : (
                          <span style={{ textTransform: "uppercase" }}>Connect wallet to view</span>
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
                  <>
                    <div style={{ marginTop: 20 }}>
                      <span style={{ fontSize: 24, fontWeight: 780 }}>{balance} {NATIVE_SYMBOL}</span>
                    </div>
                    
                    <div style={{ display: "flex", marginTop: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
                      <details>
                        <summary className="ownersBtn" style={{ cursor: "pointer", userSelect: "none", textTransform: "uppercase" }}>Owners</summary>
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
                                <span className="ownerCopyBtn">
                                  {isCopied ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                      
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
                  </>
                ) : null}
              </div>

              {isLoaded ? (
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "stretch" }}>

                  <div className="card" style={{ flex: "1 1 520px", minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 14, marginBottom: 14, textTransform: "uppercase" }}>
                      Transactions
                    </div>

                    <Msg m={txMsg} />

                    {!canView ? (
                      <div className="muted" style={{ textTransform: "uppercase" }}>Open as owner to view transactions</div>
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

                          const statusText = t.executed
                            ? null
                            : t.confirms >= THRESHOLD
                            ? "Ready to execute"
                            : `Waiting for confirmations ${Math.max(0, t.confirms)}/${THRESHOLD}`;
                          const statusIcon = t.executed ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(80,220,170,0.6)" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : null;

                          return (
                            <div key={t.id} className="txItem">
                              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                  <div style={{ fontWeight: 780, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                                    TX {t.id}
                                    {statusIcon ? (
                                      <span style={{ display: "inline-flex", alignItems: "center" }}>{statusIcon}</span>
                                    ) : (
                                      <span className={`muted ${statusText?.startsWith("Waiting") ? "blinkText" : ""}`} style={{ fontWeight: 600, textTransform: "uppercase" }}>
                                        • {statusText}
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div style={{ fontSize: 14 }}>
                                    {ethers.formatUnits(t.amount, NATIVE_DECIMALS)} {NATIVE_SYMBOL} → {short(t.to)}
                                  </div>
                                  
                                  <div className="muted" style={{ fontSize: 13, textTransform: "uppercase" }}>
                                    Signatures: {t.confirms}/{THRESHOLD}
                                  </div>

                                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
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
                                            ...(me && ok ? { 
                                              background: "rgba(80,220,170,0.1)", 
                                              borderColor: "rgba(80,220,170,0.5)",
                                              fontWeight: 700
                                            } : {})
                                          }}
                                          title={o}
                                        >
                                          {me ? "You" : `Owner ${i + 1}`}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
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
                                        <button
                                          className="btn btnOk"
                                          onClick={() => executeTx(t.id)}
                                          disabled={disableRow}
                                          type="button"
                                        >
                                          {isExecuting ? "Executing…" : "Execute"}
                                        </button>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              {u ? (
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                                  <a
                                    href={u}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btnXs"
                                    style={{ textDecoration: "none", fontSize: 11 }}
                                  >
                                    View in explorer
                                  </a>
                                </div>
                              ) : null}
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
        <div
          className="container"
          style={{ maxWidth: 1320, width: "100%", padding: "0 24px", margin: "0 auto", boxSizing: "border-box" }}
        >
          <div className="footerBar">
            <div className="footerText">© 2025 FORT · Built on Arc Network · All rights reserved.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <a className="footerX" href="https://x.com/Gioddddd" target="_blank" rel="noopener noreferrer" aria-label="X" title="X">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.4-8.4L1 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L7.5 3.9H5.7L17.8 20Z"
                    fill="currentColor"
                  />
                </svg>
              </a>
              <a
                className="footerX"
                href="https://github.com/EthernalBuddha/ARCsafe2"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                title="GitHub"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.748-1.027 2.748-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.944.36.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
                    fill="currentColor"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
