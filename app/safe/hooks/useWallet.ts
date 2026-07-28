"use client";

import { ethers } from "ethers";
import { useEffect, useRef, useState } from "react";

import {
  ARC_CHAIN_ID,
  ARC_CHAIN_ID_HEX,
  ARC_CHAIN_PARAMS,
  RPC_READ_URL,
  isArc,
} from "../lib/chain";
import { errText, isAddChainErr } from "../lib/format";
import { CONNECTED_WALLET_KEY } from "../lib/storage";

export type WalletCtx = { provider: any; signer: any };

export type PendingPatch = {
  connect?: boolean;
  switchNet?: boolean;
  syncSafes?: boolean;
  txAction?: null;
};

export type UseWalletOptions = {
  // Safe currently opened in the UI. Account and chain switches reload it.
  loadedSafe: string;
  // True while a network switch started elsewhere is still running.
  switchingNetwork: boolean;
  // Merges a patch into the page-level pending flags.
  setPending: (patch: PendingPatch) => void;
  // A usable account appeared or changed: refresh the safe list for it.
  onWalletConnected: (address: string) => void;
  // The wallet reports no usable account anymore.
  onWalletCleared: () => void;
  // The user disconnected: clear everything tied to the safe.
  onDisconnect: () => void;
  // Reload the opened safe, optionally with a freshly built provider/signer pair.
  // `silent` keeps the spinner hidden for background refreshes.
  reloadSafe: (ctx: WalletCtx | undefined, address: string, silent: boolean) => void;
};

// Owns everything about the injected wallet: provider discovery, connection,
// the Arc network guard and the account/chain event listeners. The page keeps
// the safe state and receives updates through the callbacks above.
export function useWallet(options: UseWalletOptions) {
  // Callbacks are read through a ref so the listener effects do not resubscribe
  // on every render of the page.
  const optsRef = useRef(options);
  optsRef.current = options;

  const providersRef = useRef<Record<string, any>>({});
  const ethRef = useRef<any>(null);
  const walletRef = useRef<string>("");
  const walletProviderKeyRef = useRef<string>("");
  const autoSwitchRef = useRef(false);

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletProviderKey, setWalletProviderKeyState] = useState("");

  const [wallet, setWallet] = useState("");
  const [provider, setProvider] = useState<any>(null);
  const [signer, setSigner] = useState<any>(null);
  const [chainId, setChainId] = useState(0);

  const [walletMsg, setWalletMsg] = useState<any>(null);

  // The key is also mirrored into a ref: write paths read it right after a
  // connect, before React has re-rendered with the new state.
  function setWalletProviderKey(key: string) {
    walletProviderKeyRef.current = key;
    setWalletProviderKeyState(key);
  }

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

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
    const key = walletProviderKeyRef.current;
    if (key) {
      const eth = getEthByKey(key);
      if (eth?.request) {
        const p = new ethers.BrowserProvider(eth);
        setProvider(p);
        const cid = await readChainIdDirect(eth);
        if (cid) setChainId(cid);
        return { provider: p, eth, kind: "wallet" as const };
      }
    }

    const p = new ethers.JsonRpcProvider(RPC_READ_URL);
    setProvider(p);
    setChainId(ARC_CHAIN_ID);
    return { provider: p, eth: null, kind: "rpc" as const };
  }

  async function ensureArcNetwork(eth: any) {
    if (!eth?.request) throw new Error("Wallet not found");

    const current = await readChainIdDirect(eth);
    if (isArc(current)) return true;

    optsRef.current.setPending({ switchNet: true });
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
      optsRef.current.setPending({ switchNet: false });
    }
  }

  // Single entry point for wallet writes: pick the injected provider, make sure it is
  // connected and on Arc, then hand back a fresh signer. The signer kept in state goes
  // stale after an account switch, so no write path should build its own provider.
  async function getWalletSigner() {
    const key = walletProviderKeyRef.current;
    const eth = key ? getEthByKey(key) : null;
    if (!eth?.request) throw new Error("Wallet not detected. Reconnect.");

    await ensureConnected(eth);

    const ok = await ensureArcNetwork(eth);
    if (!ok) throw new Error(`Switch to Arc Testnet (${ARC_CHAIN_ID}).`);

    const walletProvider = new ethers.BrowserProvider(eth);
    const walletSigner = await walletProvider.getSigner();
    const address = await walletSigner.getAddress();

    return { eth, provider: walletProvider, signer: walletSigner, address };
  }

  async function connectSelected(eth: any, key: string) {
    setWalletMsg(null);
    optsRef.current.setPending({ connect: true });

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
      setWalletModalOpen(false);

      try {
        localStorage.setItem(CONNECTED_WALLET_KEY, key);
      } catch {}

      const cid = await readChainIdDirect(eth);
      if (cid) setChainId(cid);

      optsRef.current.onWalletConnected(a2);
      // Do not start the safe load here: setWallet above already triggers the
      // [wallet, loadedSafe] effect. The two calls ran sequentially, so the in-flight guard missed them.

      return true;
    } catch (e) {
      setWalletMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      optsRef.current.setPending({ connect: false });
    }
  }

  function disconnectWallet() {
    setWalletModalOpen(false);
    setWallet("");
    setSigner(null);
    setWalletMsg(null);
    setWalletProviderKey("");
    ethRef.current = null;

    try {
      localStorage.removeItem(CONNECTED_WALLET_KEY);
    } catch {}

    optsRef.current.setPending({
      connect: false,
      switchNet: false,
      syncSafes: false,
      txAction: null,
    });

    optsRef.current.onDisconnect();
  }

  // Reconnect silently on load when the wallet still has an authorized account.
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
      } catch {}
    };

    const timer = setTimeout(tryAutoConnect, 300);
    return () => clearTimeout(timer);
  }, []);

  // Nudge a connected wallet back to Arc when it sits on another network.
  useEffect(() => {
    if (!wallet) return;
    const eth = walletProviderKey ? getEthByKey(walletProviderKey) : null;
    if (!eth?.request) return;
    if (options.switchingNetwork) return;
    if (chainId && isArc(chainId)) return;
    if (autoSwitchRef.current) return;

    autoSwitchRef.current = true;
    (async () => {
      try {
        await ensureConnected(eth);
        const ok = await ensureArcNetwork(eth);
        const safe = optsRef.current.loadedSafe;
        if (ok && safe) optsRef.current.reloadSafe(undefined, "", false);
      } catch {
      } finally {
        autoSwitchRef.current = false;
      }
    })();
  }, [wallet, chainId, walletProviderKey, options.loadedSafe, options.switchingNetwork]);

  // Account and chain switches performed inside the wallet UI.
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
          optsRef.current.onWalletConnected(addr);
        } else {
          setSigner(null);
          setWallet("");
          optsRef.current.onWalletCleared();
        }

        if (optsRef.current.loadedSafe) {
          optsRef.current.reloadSafe({ provider: p, signer: s2 || null }, addr || "", false);
        }
      } catch {}
    };

    const onChain = async (hexId?: any) => {
      try {
        const p = new ethers.BrowserProvider(eth);
        setProvider(p);

        // The event already carries the new chain id. Trust it first: right after a
        // switch the wallet often answers eth_chainId late or not at all, and the old
        // code then kept the stale id, so the wrong-network banner never went away.
        let cid = 0;
        if (typeof hexId === "string") {
          const v = parseInt(hexId, 16);
          if (Number.isFinite(v)) cid = v;
        }
        if (!cid) cid = await readChainIdDirect(eth);
        if (!cid) {
          await new Promise((r) => setTimeout(r, 400));
          cid = await readChainIdDirect(eth);
        }
        if (cid) setChainId(cid);

        let s2: any = null;
        let addr = "";

        try {
          s2 = await p.getSigner();
          addr = await s2.getAddress();
          setSigner(s2);
          setWallet(addr);
          optsRef.current.onWalletConnected(addr);
        } catch {}

        if (optsRef.current.loadedSafe) {
          optsRef.current.reloadSafe({ provider: p, signer: s2 || null }, addr || "", false);
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
  }, [walletProviderKey, options.loadedSafe]);

  // Safety net for chainChanged: some wallets drop the event entirely when the user
  // switches back to a previously used network. Poll the chain id while the tab is
  // visible so the wrong-network banner clears without a page reload.
  useEffect(() => {
    if (!walletProviderKey || !wallet) return;

    let stopped = false;
    let wasWrong = false;

    const check = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const eth = getEthByKey(walletProviderKey);
      if (!eth?.request) return;

      const cid = await readChainIdDirect(eth);
      if (!cid || stopped) return;

      setChainId((prev: any) => (prev === cid ? prev : cid));

      if (!isArc(cid)) {
        wasWrong = true;
        return;
      }
      if (wasWrong) {
        wasWrong = false;
        // Back on Arc: refresh the safe, its data was never loaded on the wrong network.
        if (optsRef.current.loadedSafe) optsRef.current.reloadSafe(undefined, "", true);
      }
    };

    const timer = setInterval(check, 4000);
    const onVis = () => void check();

    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [walletProviderKey, wallet, options.loadedSafe]);

  return {
    // state
    wallet,
    provider,
    signer,
    chainId,
    walletProviderKey,
    walletModalOpen,
    walletMsg,
    walletRef,

    // setters the page still needs
    setProvider,
    setSigner,
    setChainId,
    setWallet,
    setWalletModalOpen,
    setWalletMsg,

    // actions
    getEthByKey,
    readChainIdDirect,
    ensureConnected,
    ensureReadProvider,
    ensureArcNetwork,
    getWalletSigner,
    connectSelected,
    disconnectWallet,
  };
}
