"use client";

import { ethers } from "ethers";
import {
  FACTORY_ABI,
  FACTORY_ADDRESS,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  SAFE_ABI,
  THRESHOLD,
  getFactoryReader,
  getReadProvider,
} from "../lib/chain";
import { errText, normAddr } from "../lib/format";
import { addSafeForWallet, getSafesForWallet, setStoredTxHash } from "../lib/storage";

export type TxActionName =
  | "confirm"
  | "revoke"
  | "cancel"
  | "revokeCancel"
  | "execute";

export type SafeTxRow = {
  id: number;
  to: string;
  amount: bigint;
  executed: boolean;
  confirms: number;
  cancelVotes?: number;
};

export type UseTxActionsDeps = {
  // Wallet state and helpers owned by useWallet.
  wallet: string;
  signer: any;
  getWalletSigner: () => Promise<{
    eth: any;
    provider: any;
    signer: any;
    address: string;
  }>;
  setProvider: (v: any) => void;
  setSigner: (v: any) => void;
  setWallet: (v: any) => void;

  // Safe view state.
  loadedSafe: string;
  access: string;
  txs: SafeTxRow[];

  // Create-safe form state.
  owner1: string;
  owner2: string;
  owner3: string;
  newSafeName: string;
  setOwner1: (v: string) => void;
  setOwner2: (v: string) => void;
  setOwner3: (v: string) => void;
  setNewSafeName: (v: string) => void;
  setCreateSafeOpen: (v: boolean) => void;
  setCreateStep: (v: number) => void;
  setCreateMsg: (v: any) => void;

  // Transfer form state.
  txTo: string;
  txAmount: string;
  setTxTo: (v: string) => void;
  setTxAmount: (v: string) => void;
  setTransferOpen: (v: boolean) => void;
  setTxMsg: (v: any) => void;

  // Shared state and side effects.
  setPending: (updater: (x: any) => any) => void;
  setCreatedSafes: (v: string[]) => void;
  setSafeAddress: (v: string) => void;
  setTxHashes: (
    updater: (m: Record<number, string>) => Record<number, string>,
  ) => void;
  saveSafeNameOnChain: (safeAddr: string, name: string) => Promise<boolean>;
  syncSafesFromChain: (walletAddr: string, force?: boolean) => Promise<void>;
  loadSafe: (
    addr: string,
    override?: { provider?: any; signer?: any },
    walletAddr?: string,
    silent?: boolean,
    force?: boolean,
  ) => Promise<void>;
};

// All write paths of the app: creating a safe, creating a transfer and acting on an
// existing transaction. Reads stay in loadSafe / lib/safeData.
export function useTxActions(deps: UseTxActionsDeps) {
  const {
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
  } = deps;

  async function createSafe() {
    setCreateMsg(null);
    setPending((x) => ({ ...x, createSafe: true }));

    try {
      if (!wallet) {
        setCreateMsg({ kind: "err", text: "Connect wallet first" });
        return false;
      }

      const o1 = normAddr(owner1);
      const o2 = normAddr(owner2);
      const o3 = normAddr(owner3);

      if (!o1 || !o2 || !o3) {
        setCreateMsg({ kind: "err", text: "Invalid owner address" });
        return false;
      }

      const uniq = new Set([
        o1.toLowerCase(),
        o2.toLowerCase(),
        o3.toLowerCase(),
      ]);
      if (uniq.size !== 3) {
        setCreateMsg({
          kind: "err",
          text: "Owners must be 3 different addresses",
        });
        return false;
      }

      const { provider: p2, signer: s2, address: w } = await getWalletSigner();

      setProvider(p2);
      setSigner(s2);
      setWallet(w);

      const factory: any = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        s2,
      );

      const owners: [string, string, string] = [o1, o2, o3];

      let predicted: string | null = null;
      try {
        predicted = await factory.createSave.staticCall(owners);
        predicted = normAddr(predicted ?? "") || null;
      } catch {}

      const tx = await factory.createSave(owners);
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
        // Fallback: the event was not found in the receipt, so ask the factory for the
        // caller's safes and take the most recent one.
        try {
          const safes2: string[] = await getFactoryReader().getSafesForOwner(w);
          if (safes2.length > 0) safe = normAddr(safes2[safes2.length - 1]);
        } catch {}
      }

      if (!safe) {
        setCreateMsg({ kind: "ok", text: "Safe created", hash: tx.hash });
        setCreateSafeOpen(false);
        setCreateStep(0);
        await syncSafesFromChain(w, true);
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
      await loadSafe(safe, { provider: p2, signer: s2 }, w, false, true);

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
        setTxMsg({ kind: "err", text: 'Invalid value: use "." not ","' });
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

      const { signer: s2 } = await getWalletSigner();
      const safe: any = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

      // Reads go through our RPC proxy, not through the wallet: the wallet's own node
      // answers eth_call with a bare error under load, which ethers reports as a revert.
      const readerSafe: any = new ethers.Contract(
        loadedSafe,
        SAFE_ABI,
        getReadProvider(),
      );

      // The contract reserves the amount of every created transaction, so the check is
      // against availableBalance, not against the full balance.
      try {
        const avail: bigint = await readerSafe.availableBalance();
        if (value > avail) {
          setTxMsg({
            kind: "err",
            text: `Exceeds available balance: requested ${ethers.formatUnits(value, NATIVE_DECIMALS)} ${NATIVE_SYMBOL}, available ${ethers.formatUnits(avail, NATIVE_DECIMALS)} ${NATIVE_SYMBOL}. The rest is reserved by pending transactions.`,
          });
          return false;
        }
      } catch {}

      // Simulate first: a revert here is free, a revert after signing costs gas.
      // Only a decoded revert reason blocks the send. A network failure must not: the node
      // returning "missing revert data" says nothing about whether the call would succeed.
      try {
        await readerSafe.createTx.staticCall(to, value, { from: wallet });
      } catch (e: any) {
        const reason = typeof e?.reason === "string" ? e.reason : "";
        if (reason) {
          setTxMsg({ kind: "err", text: `Transaction would fail: ${reason}` });
          return false;
        }
      }

      const tx = await safe.createTx(to, value);
      const rc = await tx.wait();

      // The id comes from the receipt. A static call only predicts it, and another owner
      // can get their own transaction mined in between.
      let createdId = -1;
      try {
        const iface = new ethers.Interface(SAFE_ABI);
        const topic0 = ethers.id("TxCreated(uint256,address,address,uint256)");
        for (const lg of Array.isArray(rc?.logs) ? rc.logs : []) {
          if ((lg?.address || "").toLowerCase() !== loadedSafe.toLowerCase())
            continue;
          if (lg?.topics?.[0] !== topic0) continue;
          const parsed = iface.parseLog(lg);
          const n = Number(parsed?.args?.id);
          if (Number.isFinite(n) && n >= 0) {
            createdId = n;
            break;
          }
        }
      } catch {}

      if (createdId >= 0) {
        setStoredTxHash(loadedSafe, createdId, tx.hash);
        setTxHashes((m) => ({ ...m, [createdId]: tx.hash }));
      }

      setTxTo("");
      setTxAmount("");

      setTxMsg({ kind: "ok", text: "Transaction created", hash: tx.hash });
      await loadSafe(loadedSafe, undefined, undefined, false, true);

      setTransferOpen(false);
      return true;
    } catch (e) {
      setTxMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setPending((x) => ({ ...x, createTx: false }));
    }
  }

  async function runTxAction(id: number, action: TxActionName) {
    setTxMsg(null);
    setPending((x) => ({ ...x, txAction: { id, action } }));
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

      const { signer: s2 } = await getWalletSigner();
      const safe: any = new ethers.Contract(loadedSafe, SAFE_ABI, s2);

      if (action === "execute") {
        const t = txs.find((x) => x.id === id);
        if (t) {
          try {
            // executeTx checks the full balance, not availableBalance: the amount of this
            // transaction is released from pendingAmount as it executes.
            // Read through our RPC proxy: the wallet's own node answers unreliably under load.
            const bal = await getReadProvider().getBalance(loadedSafe);
            if (bal < t.amount) {
              setTxMsg({
                kind: "err",
                text: `Insufficient safe balance. Need ${ethers.formatUnits(t.amount, NATIVE_DECIMALS)} ${NATIVE_SYMBOL}, safe holds ${ethers.formatUnits(bal, NATIVE_DECIMALS)} ${NATIVE_SYMBOL}.`,
              });
              return;
            }
          } catch {}
        }
      }

      const tx =
        action === "confirm"
          ? await safe.confirmTx(id)
          : action === "revoke"
            ? await safe.revokeConfirm(id)
            : action === "cancel"
              ? await safe.cancelTx(id)
              : action === "revokeCancel"
                ? await safe.revokeCancelVote(id)
                : await safe.executeTx(id);
      const rc = await tx.wait();

      setStoredTxHash(loadedSafe, id, tx.hash);
      setTxHashes((m) => ({ ...m, [id]: tx.hash }));

      let label =
        action === "confirm"
          ? "confirmed"
          : action === "revoke"
            ? "revoked"
            : action === "revokeCancel"
              ? "cancel vote revoked"
              : action === "cancel"
                ? "cancel vote recorded"
                : "executed";

      if (action === "cancel") {
        // Cancellation needs THRESHOLD votes. Only a TxCanceled event means the transaction
        // is really dead; a single vote is just recorded, and the transaction stays active.
        let reallyCanceled = false;
        let votes = 0;
        try {
          const iface = new ethers.Interface(SAFE_ABI);
          const canceledTopic = ethers.id("TxCanceled(uint256,address)");
          const votedTopic = ethers.id("TxCancelVoted(uint256,address,uint8)");
          for (const lg of Array.isArray(rc?.logs) ? rc.logs : []) {
            if ((lg?.address || "").toLowerCase() !== loadedSafe.toLowerCase())
              continue;
            if (lg?.topics?.[0] === canceledTopic) reallyCanceled = true;
            if (lg?.topics?.[0] === votedTopic) {
              const parsed = iface.parseLog(lg);
              const n = Number(parsed?.args?.votes);
              if (Number.isFinite(n)) votes = n;
            }
          }
        } catch {}

        label = reallyCanceled
          ? "canceled"
          : `cancel vote ${Math.max(1, votes)}/${THRESHOLD} recorded \u2014 the transaction is still active`;
      }

      setTxMsg({ kind: "ok", text: `TX ${id} ${label}`, hash: tx.hash, id });
      await loadSafe(loadedSafe, undefined, undefined, false, true);
    } catch (e) {
      setTxMsg({ kind: "err", text: errText(e), id });
    } finally {
      setPending((x) => ({ ...x, txAction: null }));
    }
  }

  return {
    createSafe,
    createTx,
    runTxAction,
    confirmTx: (id: number) => runTxAction(id, "confirm"),
    revokeConfirm: (id: number) => runTxAction(id, "revoke"),
    cancelTx: (id: number) => runTxAction(id, "cancel"),
    revokeCancelVote: (id: number) => runTxAction(id, "revokeCancel"),
    executeTx: (id: number) => runTxAction(id, "execute"),
  };
}
