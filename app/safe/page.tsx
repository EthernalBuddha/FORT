"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ethers } from "ethers";
import styles from "./page.module.css";
import WalletMenu from "../../components/WalletMenu";
import WalletConnectModal from "../../components/WalletConnectModal";
import { Msg } from "./components/ui";
import CreateSafeModal from "./components/CreateSafeModal";
import TransferModal from "./components/TransferModal";
import RenameSafeModal from "./components/RenameSafeModal";
import RemoveSafeModal from "./components/RemoveSafeModal";
import { TxCard } from "./components/TxCard";
import { SafeRow } from "./components/SafeRow";
import {
  ARC_CHAIN_ID,
  FACTORY_ABI,
  FACTORY_ADDRESS,
  NATIVE_SYMBOL,
  SAFE_ABI,
  getFactoryReader,
  getReadProvider,
  isArc,
  txUrl,
} from "./lib/chain";
import { errText, normAddr, setSafeParamInUrl, short } from "./lib/format";
import {
  addSafeForWallet,
  getSafeCache,
  getSafesForWallet,
  hideSafe,
  isSafeHidden,
  removeSafeFromWallet,
  setSafeCache,
  unhideSafe,
} from "./lib/storage";
import {
  fetchSafeSnapshot,
  isMissingContractError,
  resolveSafeOwners,
  type SafeTx,
} from "./lib/safeData";
import { useWallet } from "./hooks/useWallet";
import { useTxActions, type TxActionName } from "./hooks/useTxActions";

// Safe owners are fixed at creation time, so read them once per address.
const safeOwnersCache = new Map<string, string[]>();

// Request the safe name only once: the safeNames state captured in the loadSafe
// closure goes stale, which made the background poll refetch the name every 15 seconds.
const safeNameRequested = new Set<string>();

export default function Page() {
  // Guard against repeated and parallel loads of the same safe: loadSafe is triggered
  // by the mount effect, the [wallet, loadedSafe] effect, auto-connect and the poll.
  const loadSafeInFlightRef = useRef<string>("");
  // A time-based cooldown was not enough: with a slow node the repeat call arrived seconds later.
  // Remember what is already loaded: the safe address plus the wallet.
  const loadSafeLoadedRef = useRef<string>("");
  // Last started run, used to coalesce forced loads fired by several effects at once.
  const loadSafeLastRunRef = useRef<{ key: string; at: number }>({
    key: "",
    at: 0,
  });
  // The safe list was requested from three places at once: connectSelected, accountsChanged
  // and chainChanged. One in-flight key plus a set of synced wallets removes the duplicates.
  const syncSafesInFlightRef = useRef<string>("");
  const syncedWalletsRef = useRef<Set<string>>(new Set());
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
  // Free balance from the contract: what is not reserved by created transactions.
  const [available, setAvailable] = useState("");
  const [txs, setTxs] = useState<SafeTx[]>([]);
  const [txHashes, setTxHashes] = useState<Record<number, string>>({});
  const [txConfirmedByOwner, setTxConfirmedByOwner] = useState<
    Record<number, boolean[]>
  >({});
  const [txCanceled, setTxCanceled] = useState<Record<number, boolean>>({});
  // Whether the connected owner has already voted to cancel a given transaction.
  const [txCancelVotedByMe, setTxCancelVotedByMe] = useState<
    Record<number, boolean>
  >({});

  const [txTo, setTxTo] = useState("");
  const [txAmount, setTxAmount] = useState("");

  const [ownerIndex, setOwnerIndex] = useState(-1);
  const [access, setAccess] = useState<
    "none" | "checking" | "owner" | "denied"
  >("none");

  const [loadingSafe, setLoadingSafe] = useState(false);
  const [safeErr, setSafeErr] = useState("");

  const [createdSafes, setCreatedSafes] = useState<string[]>([]);
  const [safeNames, setSafeNames] = useState<Record<string, string>>({});

  const [createMsg, setCreateMsg] = useState<any>(null);
  const [txMsg, setTxMsg] = useState<any>(null);

  const [pending, setPending] = useState({
    connect: false,
    createSafe: false,
    createTx: false,
    txAction: null as null | {
      id: number;
      action: TxActionName;
    },
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
  const [renameMsg, setRenameMsg] = useState<any>(null);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeAddr, setRemoveAddr] = useState("");

  const [copyTipOpen, setCopyTipOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // Wallet, network guard and injected-provider events live in a dedicated hook.
  const {
    wallet,
    provider,
    signer,
    chainId,
    walletProviderKey,
    walletModalOpen,
    walletMsg,
    walletRef,
    setProvider,
    setSigner,
    setChainId,
    setWallet,
    setWalletModalOpen,
    setWalletMsg,
    getEthByKey,
    readChainIdDirect,
    ensureConnected,
    ensureReadProvider,
    ensureArcNetwork,
    getWalletSigner,
    connectSelected,
    disconnectWallet,
  } = useWallet({
    loadedSafe,
    switchingNetwork: pending.switchNet,
    setPending: (patch) => setPending((x) => ({ ...x, ...patch })),
    onWalletConnected: (address) => {
      setCreatedSafes(getSafesForWallet(address));
      void syncSafesFromChain(address);
    },
    onWalletCleared: () => {
      setCreatedSafes([]);
      setAccess("none");
      setOwnerIndex(-1);
    },
    onDisconnect: clearSafeStateOnDisconnect,
    reloadSafe: (ctx, address, silent) =>
      void loadSafe(
        loadedSafe,
        ctx,
        address || walletRef.current || "",
        silent,
        true,
      ),
  });

  async function fetchSafeName(safeAddr: string): Promise<string> {
    try {
      return (await getFactoryReader().getSafeName(safeAddr)) || "";
    } catch {
      return "";
    }
  }

  async function saveSafeNameOnChain(safeAddr: string, name: string) {
    setRenameMsg(null);

    const a = normAddr(safeAddr);
    if (!a) {
      setRenameMsg({ kind: "err", text: "Invalid safe address" });
      return false;
    }

    setPending((x) => ({ ...x, rename: true }));
    try {
      const { signer: s2, address } = await getWalletSigner();
      const me = address.toLowerCase();

      // The factory checks its own safeOwners mapping, which is only filled by createSave.
      // Safes deployed by an older factory are missing there and can never be renamed.
      try {
        const known: string[] = await getFactoryReader().getSafeOwners(a);
        const list = [known?.[0], known?.[1], known?.[2]].map((o) =>
          (o || "").toLowerCase(),
        );
        const empty = list.every(
          (o) => !o || o === ethers.ZeroAddress.toLowerCase(),
        );

        if (empty) {
          setRenameMsg({
            kind: "err",
            text: "This safe was created by an older factory, so the current factory cannot store its name. Renaming works only for safes created by the current factory.",
          });
          return false;
        }
        if (!list.includes(me)) {
          setRenameMsg({
            kind: "err",
            text: "Only an owner of this safe can rename it.",
          });
          return false;
        }
      } catch {}

      // The contract measures MAX_NAME_LENGTH in bytes, not in characters:
      // a Cyrillic letter takes two bytes in UTF-8, so counting characters here
      // would let a name through that reverts with "name too long" after signing.
      const nameBytes = new TextEncoder().encode(name).length;
      if (nameBytes > 32) {
        setRenameMsg({
          kind: "err",
          text: `Name too long: 32 bytes max (this one is ${nameBytes}). Non-Latin letters take two bytes each.`,
        });
        return false;
      }

      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, s2);
      const tx = await factory.setSafeName(a, name);
      await tx.wait();

      setSafeNames((prev) => ({ ...prev, [a.toLowerCase()]: name }));
      // Allow the name to be re-read from the chain later.
      safeNameRequested.delete(a.toLowerCase());
      return true;
    } catch (e: any) {
      setRenameMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setPending((x) => ({ ...x, rename: false }));
    }
  }

  async function syncSafesFromChain(walletAddr: string, force?: boolean) {
    const w = normAddr(walletAddr);
    if (!w) return;

    const key = w.toLowerCase();
    if (syncSafesInFlightRef.current === key) return;
    if (!force && syncedWalletsRef.current.has(key)) {
      setCreatedSafes(getSafesForWallet(w));
      return;
    }
    syncSafesInFlightRef.current = key;

    setPending((x) => ({ ...x, syncSafes: true }));
    try {
      const safes: string[] = await getFactoryReader().getSafesForOwner(w);

      for (const safe of safes) {
        const addr = normAddr(safe);
        if (addr) addSafeForWallet(w, addr);
      }

      setCreatedSafes(getSafesForWallet(w));

      // Names are fetched in parallel: a sequential loop meant one round trip per safe,
      // so with 20 safes on a slow node the sidebar filled in only after ~30 seconds.
      const addrs = safes
        .map((safe) => normAddr(safe))
        .filter(Boolean) as string[];
      const fetched = await Promise.all(
        addrs.map(
          async (addr) =>
            [addr.toLowerCase(), await fetchSafeName(addr)] as const,
        ),
      );

      const names: Record<string, string> = {};
      for (const [key2, name] of fetched) {
        if (name) names[key2] = name;
      }
      setSafeNames((prev) => ({ ...prev, ...names }));
      syncedWalletsRef.current.add(key);
    } catch {
      setCreatedSafes(getSafesForWallet(w));
    } finally {
      if (syncSafesInFlightRef.current === key)
        syncSafesInFlightRef.current = "";
      setPending((x) => ({ ...x, syncSafes: false }));
    }
  }

  // The wallet side of a disconnect is handled inside useWallet; this drops the safe state.
  function clearSafeStateOnDisconnect() {
    setOwnerIndex(-1);
    setAccess("none");
    setCreatedSafes([]);
    setOwners([]);
    setTxs([]);
    setTxHashes({});
    setTxConfirmedByOwner({});
    setTxCanceled({});
    setBalance("0");
    setRowMenuOpenFor("");
    setRenameOpen(false);
    setRemoveOpen(false);
    syncSafesInFlightRef.current = "";
    syncedWalletsRef.current.clear();
  }

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
      setCreatedSafes(removeSafeFromWallet(w, s));
      if (loadedSafe && loadedSafe.toLowerCase() === s.toLowerCase()) {
        setLoadedSafe("");
        setSafeAddress("");
        setOwners([]);
        setTxs([]);
        setTxHashes({});
        setTxConfirmedByOwner({});
        setTxCanceled({});
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

  // The ?safe= address only sets state. Loading is done by the [wallet, loadedSafe] effect:
  // loadSafe used to run twice, first without a wallet and then with it, and the guard did not merge them.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const s = u.searchParams.get("safe") || "";
      const a = normAddr(s);
      if (a) {
        setSafeAddress(a);
        setLoadedSafe(a);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!loadedSafe) return;
    if (!wallet) return;
    loadSafe(loadedSafe, undefined, wallet);
  }, [wallet, loadedSafe]);

  useEffect(() => {
    if (!loadedSafe || access !== "owner") return;
    const refresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadSafe(loadedSafe, undefined, walletRef.current, true, true);
    };
    const timer = setInterval(refresh, 15000);
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadedSafe, access]);

  // Clears everything shown for a safe. Used whenever access is lost: wrong network,
  // no wallet, unreadable contract or a wallet that is not an owner.
  function resetSafeView(state: "none" | "denied" = "none") {
    setAccess(state);
    setOwnerIndex(-1);
    setOwners([]);
    setTxs([]);
    setTxHashes({});
    setTxConfirmedByOwner({});
    setTxCanceled({});
    setBalance("0");
  }

  async function loadSafe(
    addr: string,
    override?: { provider?: any; signer?: any },
    walletAddr?: string,
    silent?: boolean,
    force?: boolean,
  ) {
    const guardAddr = normAddr(addr);
    const guardWallet = (walletAddr || walletRef.current || "").toLowerCase();
    const runKey = guardAddr ? `${guardAddr.toLowerCase()}:${guardWallet}` : "";

    if (runKey && !force) {
      // The same load is already running: a second pass would only duplicate node requests.
      if (loadSafeInFlightRef.current === runKey) return;
      // This safe is already loaded for this wallet. Refreshes go through force:
      // the background poll, network/account changes and transaction actions.
      if (loadSafeLoadedRef.current === runKey) return;
    }

    // Forced loads are coalesced too: on entry the mount effect, wallet connect and the
    // network auto-switch ask for the same safe within a few hundred milliseconds.
    if (runKey && force) {
      if (loadSafeInFlightRef.current === runKey) return;
      const last = loadSafeLastRunRef.current;
      if (last.key === runKey && Date.now() - last.at < 1500) return;
    }

    if (runKey) {
      loadSafeInFlightRef.current = runKey;
      loadSafeLastRunRef.current = { key: runKey, at: Date.now() };
    }

    setSafeErr("");
    if (!silent) {
      setLoadingSafe(true);
      setAvailable("");
    }

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

      // The wallet is only used for signing and network detection. Reads go through the proxy.
      const rp = getReadProvider();

      const cid = eth ? await readChainIdDirect(eth) : ARC_CHAIN_ID;
      if (cid) setChainId(cid);

      if (!isArc(cid)) {
        resetSafeView();
        setSafeErr(`Wrong network. Switch to Arc Testnet (${ARC_CHAIN_ID}).`);
        setLoadingSafe(false);
        return;
      }

      // We never read contract bytecode: getCode cost ~17.5 kB on every entry.
      // A missing contract or a network error still shows up when reading owners().

      if (!hasWallet) {
        resetSafeView();
        setSafeErr("");
        setLoadingSafe(false);
        return;
      }

      if (!silent) setAccess("checking");

      const cached = getSafeCache(a, activeWallet);
      if (
        cached &&
        cached.wallet === activeWallet.toLowerCase() &&
        Array.isArray(cached.owners)
      ) {
        try {
          setOwners(cached.owners);
          const cIdx = cached.owners.findIndex(
            (o: string) =>
              (o || "").toLowerCase() === activeWallet.toLowerCase(),
          );
          if (cIdx >= 0) {
            setAccess("owner");
            setOwnerIndex(cIdx);
          }
          if (typeof cached.balance === "string") setBalance(cached.balance);
          if (Array.isArray(cached.txs)) {
            setTxs(
              cached.txs.map((t: any) => ({
                id: t.id,
                to: t.to,
                amount: BigInt(t.amount),
                executed: t.executed,
                confirms: t.confirms,
                cancelVotes: Number(t.cancelVotes || 0),
              })),
            );
          }
          if (cached.sigs) setTxConfirmedByOwner(cached.sigs);
          if (cached.cancel) setTxCanceled(cached.cancel);
          if (cached.myCancelVotes) setTxCancelVotedByMe(cached.myCancelVotes);
          if (typeof cached.available === "string")
            setAvailable(cached.available);
          if (cached.name)
            setSafeNames((prev) => ({
              ...prev,
              [a.toLowerCase()]: cached.name,
            }));
          setLoadingSafe(false);
        } catch {}
      }

      const reader: any = new ethers.Contract(a, SAFE_ABI, rp);

      // A network error and an actual lack of access are different things.
      let ownersArr: string[] = [];
      try {
        ownersArr = await resolveSafeOwners(rp, reader, a, safeOwnersCache);
      } catch (e: any) {
        resetSafeView();
        setSafeErr(
          isMissingContractError(e)
            ? "No contract at this address on current network"
            : "Cannot read safe owners: " + errText(e),
        );
        setLoadingSafe(false);
        return;
      }

      const cur = activeWallet.toLowerCase();
      let idx = -1;
      ownersArr.forEach((o, i) => {
        if ((o || "").toLowerCase() === cur) idx = i;
      });

      if (idx < 0) {
        resetSafeView("denied");
        setSafeErr(
          `Connected wallet ${short(activeWallet)} is not an owner of this safe. Switch to one of the 3 owner wallets to access it.`,
        );
        setLoadingSafe(false);
        return;
      }

      setAccess("owner");
      setOwnerIndex(idx);
      setOwners(ownersArr);

      // Skip the request while syncSafesFromChain is already fetching names for this wallet:
      // otherwise both paths ask the node for the same getSafeName on page open.
      const syncingThisWallet =
        syncSafesInFlightRef.current === activeWallet.toLowerCase();

      if (
        !syncingThisWallet &&
        !safeNames[a.toLowerCase()] &&
        !safeNameRequested.has(a.toLowerCase())
      ) {
        safeNameRequested.add(a.toLowerCase());
        fetchSafeName(a).then(
          (name) => {
            if (name)
              setSafeNames((prev) => ({ ...prev, [a.toLowerCase()]: name }));
            else safeNameRequested.delete(a.toLowerCase());
          },
          () => safeNameRequested.delete(a.toLowerCase()),
        );
      }

      const n = (safeNames[a.toLowerCase()] || "").trim();
      setSafeParamInUrl(a, n);

      const snap = await fetchSafeSnapshot({
        safeReader: reader,
        readProvider: rp,
        safeAddress: a,
        wallet: activeWallet,
        cached,
        silent: !!silent,
      });

      setBalance(snap.balance);
      setAvailable(snap.available);
      setTxs(snap.items);
      setTxHashes(snap.txHashes);
      setTxConfirmedByOwner(snap.sigMap);
      setTxCanceled(snap.cancelMap);
      setTxCancelVotedByMe(snap.myCancelVotes);

      setSafeCache(a, activeWallet, {
        owners: ownersArr,
        balance: snap.balance,
        available: snap.available,
        txs: snap.items.map((t) => ({
          id: t.id,
          to: t.to,
          amount: t.amount.toString(),
          executed: t.executed,
          confirms: t.confirms,
          cancelVotes: Number(t.cancelVotes || 0),
        })),
        sigs: snap.sigMap,
        cancel: snap.cancelMap,
        myCancelVotes: snap.myCancelVotes,
        name: (safeNames[a.toLowerCase()] || "").trim(),
      });

      addSafeForWallet(activeWallet, a);
      setCreatedSafes(getSafesForWallet(activeWallet));

      if (runKey) loadSafeLoadedRef.current = runKey;
    } catch (e) {
      resetSafeView();
      setSafeErr(errText(e));
    } finally {
      if (runKey && loadSafeInFlightRef.current === runKey) {
        loadSafeInFlightRef.current = "";
      }
      setLoadingSafe(false);
    }
  }

  // Every on-chain write lives in one hook: create safe, create transfer, act on a tx.
  const {
    createSafe,
    createTx,
    confirmTx,
    revokeConfirm,
    cancelTx,
    revokeCancelVote,
    executeTx,
  } = useTxActions({
    wallet,
    signer,
    getWalletSigner,
    setProvider,
    setSigner,
    setWallet,
    loadedSafe,
    access,
    txs,
    owner1,
    owner2,
    owner3,
    newSafeName,
    setOwner1,
    setOwner2,
    setOwner3,
    setNewSafeName,
    setCreateSafeOpen,
    setCreateStep,
    setCreateMsg,
    txTo,
    txAmount,
    setTxTo,
    setTxAmount,
    setTransferOpen,
    setTxMsg,
    setPending,
    setCreatedSafes,
    setSafeAddress,
    setTxHashes,
    saveSafeNameOnChain,
    syncSafesFromChain,
    loadSafe,
  });

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

  // "No safes yet" used to show up even when the list only looked empty because
  // every safe was hidden or filtered out by the search box.
  const emptySafeListText = useMemo(() => {
    if (createdSafes.length === 0) return "No safes yet";
    if ((safeSearch || "").trim()) return "Nothing found";
    return showHidden ? "No hidden safes" : "All safes are hidden";
  }, [createdSafes, safeSearch, showHidden]);

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
    background:
      "radial-gradient(120% 120% at 20% 10%, rgba(64, 120, 255, 0.22), rgba(6, 10, 22, 0.95))",
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
    textShadow:
      "0 1px 0 rgba(255,255,255,0.30), 0 10px 22px rgba(0,0,0,0.48), 0 22px 56px rgba(0,0,0,0.36)",
  };

  const headerStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 10,
    padding: 0,
    background:
      "linear-gradient(180deg, rgba(6,10,20,0.70) 0%, rgba(6,10,20,0.10) 100%)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  return (
    <div
      className={styles.wrap}
      style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <WalletConnectModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onSelect={async (eth: any, key: string) => {
          return await connectSelected(eth, key);
        }}
      />

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        to={txTo}
        setTo={setTxTo}
        amount={txAmount}
        setAmount={setTxAmount}
        msg={txMsg}
        busy={pending.createTx}
        onCreate={createTx}
      />

      <CreateSafeModal
        open={createSafeOpen}
        onClose={() => setCreateSafeOpen(false)}
        step={createStep}
        setStep={setCreateStep}
        name={newSafeName}
        setName={setNewSafeName}
        owner1={owner1}
        setOwner1={setOwner1}
        owner2={owner2}
        setOwner2={setOwner2}
        owner3={owner3}
        setOwner3={setOwner3}
        msg={createMsg}
        busy={pending.createSafe}
        onCreate={createSafe}
      />

      <RenameSafeModal
        open={renameOpen}
        onClose={() => {
          setRenameOpen(false);
          setRenameAddr("");
          setRenameValue("");
          setRenameMsg(null);
        }}
        addr={renameAddr}
        value={renameValue}
        setValue={setRenameValue}
        msg={renameMsg}
        busy={pending.rename}
        onSave={saveSafeNameOnChain}
      />

      <RemoveSafeModal
        open={removeOpen}
        onClose={() => {
          setRemoveOpen(false);
          setRemoveAddr("");
        }}
        onConfirm={() => {
          if (!wallet) return;
          const a = normAddr(removeAddr);
          if (!a) return;
          removeSafeForWallet(wallet, a);
          setRemoveOpen(false);
          setRemoveAddr("");
        }}
      />

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
        <div
          className="container stack"
          style={{ maxWidth: 1320, width: "100%" }}
        >
          <Msg m={walletMsg} />

          {wrongNet ? (
            <div className="banner bannerErr">
              <div>
                Wrong network. Switch to Arc Testnet ({ARC_CHAIN_ID}). Detected:{" "}
                {chainId}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const eth = walletProviderKey
                        ? getEthByKey(walletProviderKey)
                        : null;
                      if (!eth?.request) {
                        setWalletMsg({
                          kind: "err",
                          text: "Connect wallet first",
                        });
                        return;
                      }
                      await ensureConnected(eth);
                      const ok = await ensureArcNetwork(eth);
                      if (ok && loadedSafe)
                        await loadSafe(
                          loadedSafe,
                          undefined,
                          undefined,
                          false,
                          true,
                        );
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
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    textTransform: "uppercase",
                  }}
                >
                  My Safes
                </h2>
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
                    <div className="muted">
                      Connect wallet to see your safes
                    </div>
                  ) : filteredSafes.length === 0 ? (
                    <div className="muted">{emptySafeListText}</div>
                  ) : (
                    filteredSafes.map((a, idx) => (
                      <SafeRow
                        key={a}
                        address={a}
                        name={(safeNames[a.toLowerCase()] || "").trim()}
                        active={
                          !!loadedSafe &&
                          a.toLowerCase() === loadedSafe.toLowerCase()
                        }
                        hidden={isSafeHidden(wallet, a)}
                        menuOpen={
                          !!rowMenuOpenFor &&
                          rowMenuOpenFor.toLowerCase() === a.toLowerCase()
                        }
                        openUp={
                          filteredSafes.length >= 6
                            ? idx >= filteredSafes.length - 2
                            : filteredSafes.length >= 3
                              ? idx === filteredSafes.length - 1
                              : false
                        }
                        onSelect={(addr) => {
                          setSafeAddress(addr);
                          loadSafe(addr);
                        }}
                        onToggleMenu={(addr) =>
                          setRowMenuOpenFor((cur) =>
                            cur && cur.toLowerCase() === addr.toLowerCase()
                              ? ""
                              : addr,
                          )
                        }
                        onRename={(addr) => {
                          setRowMenuOpenFor("");
                          setRenameAddr(addr);
                          setRenameValue(
                            (safeNames[addr.toLowerCase()] || "").trim(),
                          );
                          setRenameMsg(null);
                          setRenameOpen(true);
                        }}
                        onToggleHide={(addr) => {
                          setRowMenuOpenFor("");
                          if (isSafeHidden(wallet, addr))
                            unhideSafe(wallet, addr);
                          else hideSafe(wallet, addr);
                          setCreatedSafes([...createdSafes]);
                        }}
                      />
                    ))
                  )}
                </div>

                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    marginTop: 6,
                    gap: 8,
                  }}
                >
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
                        setWalletMsg({
                          kind: "err",
                          text: "Invalid safe address",
                        });
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
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        minWidth: 0,
                      }}
                    >
                      <h2
                        style={{
                          margin: 0,
                          fontSize: 22,
                          flex: "0 0 auto",
                          textTransform: "uppercase",
                        }}
                      >
                        Safe
                      </h2>
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

                    <div
                      className="muted"
                      style={{
                        marginTop: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
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
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <rect
                                    x="9"
                                    y="9"
                                    width="13"
                                    height="13"
                                    rx="2"
                                  />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          </>
                        ) : wallet ? (
                          "Restricted"
                        ) : (
                          <span style={{ textTransform: "uppercase" }}>
                            Connect wallet to view
                          </span>
                        )
                      ) : (
                        "Select a safe from the list"
                      )}
                    </div>

                    {safeErr ? (
                      <div
                        className="err"
                        style={{ marginTop: 10, fontSize: 13 }}
                      >
                        {safeErr}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="row"
                    style={{ gap: 10, alignItems: "center" }}
                  >
                    {accessBadge}
                  </div>
                </div>

                {isLoaded && canView ? (
                  <>
                    <div style={{ marginTop: 20 }}>
                      <span style={{ fontSize: 24, fontWeight: 780 }}>
                        {balance} {NATIVE_SYMBOL}
                      </span>
                      {available && available !== balance ? (
                        <span
                          className="muted"
                          style={{
                            marginLeft: 10,
                            fontSize: 13,
                            textTransform: "uppercase",
                          }}
                          title="Free balance: the rest is reserved by pending transactions"
                        >
                          available {available} {NATIVE_SYMBOL}
                        </span>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        marginTop: 16,
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      <details>
                        <summary
                          className="ownersBtn"
                          style={{
                            cursor: "pointer",
                            userSelect: "none",
                            textTransform: "uppercase",
                          }}
                        >
                          Owners
                        </summary>
                        <div className="stackSm" style={{ marginTop: 12 }}>
                          {owners.map((o, i) => {
                            const isMe =
                              wallet &&
                              wallet.toLowerCase() === o.toLowerCase();
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
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    >
                                      <rect
                                        x="9"
                                        y="9"
                                        width="13"
                                        height="13"
                                        rx="2"
                                      />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
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
                        title={
                          !canView
                            ? "Open a safe as owner to create transfers"
                            : "Create a new transfer"
                        }
                      >
                        New transfer
                      </button>
                    </div>
                  </>
                ) : null}
              </div>

              {isLoaded ? (
                <div
                  style={{
                    display: "flex",
                    gap: 18,
                    flexWrap: "wrap",
                    alignItems: "stretch",
                  }}
                >
                  <div
                    className="card"
                    style={{ flex: "1 1 520px", minWidth: 0 }}
                  >
                    <div
                      className="muted"
                      style={{
                        fontSize: 14,
                        marginBottom: 14,
                        textTransform: "uppercase",
                      }}
                    >
                      Transactions
                    </div>

                    <Msg m={txMsg && txMsg.id == null ? txMsg : null} />

                    {!canView ? (
                      <div
                        className="muted"
                        style={{ textTransform: "uppercase" }}
                      >
                        Open as owner to view transactions
                      </div>
                    ) : txs.length === 0 ? (
                      <div className="muted">No transactions</div>
                    ) : (
                      <div
                        className="stackSm"
                        style={{
                          maxHeight: 520,
                          overflow: "auto",
                          paddingRight: 4,
                        }}
                      >
                        {txs.map((t) => (
                          <TxCard
                            key={t.id}
                            tx={t}
                            owners={owners}
                            ownerIndex={ownerIndex}
                            sigs={txConfirmedByOwner?.[t.id] || []}
                            isCanceled={!!txCanceled?.[t.id]}
                            iVotedCancel={!!txCancelVotedByMe?.[t.id]}
                            explorerUrl={
                              txHashes?.[t.id] ? txUrl(txHashes[t.id]) : ""
                            }
                            txAction={pending.txAction}
                            onConfirm={confirmTx}
                            onRevokeConfirm={revokeConfirm}
                            onExecute={executeTx}
                            onCancel={cancelTx}
                            onRevokeCancelVote={revokeCancelVote}
                            msg={txMsg && txMsg.id === t.id ? txMsg : null}
                          />
                        ))}
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
          style={{
            maxWidth: 1320,
            width: "100%",
            padding: "0 24px",
            margin: "0 auto",
            boxSizing: "border-box",
          }}
        >
          <div className="footerBar">
            <div className="footerText">
              © 2026 FORT · Built on Arc · All rights reserved.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <a
                className="footerX"
                href="https://x.com/Gioddddd"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
                title="X"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.4-8.4L1 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L7.5 3.9H5.7L17.8 20Z"
                    fill="currentColor"
                  />
                </svg>
              </a>
              <a
                className="footerX"
                href="https://github.com/EthernalBuddha/FORT"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                title="GitHub"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
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
