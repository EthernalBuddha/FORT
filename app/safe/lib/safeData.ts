import { ethers } from "ethers";

import { FACTORY_ABI, FACTORY_ADDRESS, NATIVE_DECIMALS } from "./chain";
import { getStoredTxHash, setStoredTxHash } from "./storage";
import { fetchTxHashesByBlocks, type TxBlocks } from "./txHashes";

export type SafeTx = {
  id: number;
  to: string;
  amount: bigint;
  executed: boolean;
  confirms: number;
  cancelVotes: number;
};

export type SafeSnapshot = {
  balance: string;
  available: string;
  items: SafeTx[];
  sigMap: Record<number, boolean[]>;
  cancelMap: Record<number, boolean>;
  myCancelVotes: Record<number, boolean>;
  txHashes: Record<number, string>;
};

// Reading a batch of transactions in one call instead of one request per record.
// getTxSummaries omits the `data` field and returns its length instead, so every record
// has a fixed size of about 450 bytes and the response no longer depends on calldata.
const TX_CHUNK = 50;

// Background polls only re-read the tail of the list. Older transactions are already
// executed or canceled and never change again, so refetching them every 15 seconds
// just wastes traffic. The full list is still read on any non-silent load.
const TX_TAIL = 20;

// A tail-only background refresh froze open transactions below the window: a
// confirmation or a cancel vote cast by another owner appeared only after a full
// page reload. Those are re-read too, capped so the poll stays cheap.
const OPEN_REFRESH_LIMIT = 30;

// The owners of a safe are fixed at creation time, so a failure here means the network
// is unreachable or there is no contract at this address.
export function isMissingContractError(e: any) {
  return (
    e?.code === "BAD_DATA" || e?.code === "CALL_EXCEPTION" || String(e?.value ?? "") === "0x"
  );
}

// One factory call instead of three owners(i) reads. Safes created by older factories
// are not registered there, so fall back to asking the safe itself.
export async function resolveSafeOwners(
  readProvider: any,
  safeReader: any,
  safeAddress: string,
  cache: Map<string, string[]>
): Promise<string[]> {
  const key = safeAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.length === 3) return cached;

  let fromFactory: string[] = [];
  try {
    const factoryReader: any = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
    const res = await factoryReader.getSafeOwners(safeAddress);
    const trio = [res?.[0], res?.[1], res?.[2]];
    if (trio.every((o: string) => !!o && o !== ethers.ZeroAddress)) fromFactory = trio;
  } catch {
    fromFactory = [];
  }

  let owners: string[];
  if (fromFactory.length === 3) {
    owners = fromFactory;
  } else {
    const [a0, a1, a2] = await Promise.all([
      safeReader.owners(0),
      safeReader.owners(1),
      safeReader.owners(2),
    ]);
    owners = [a0, a1, a2];
  }

  cache.set(key, owners);
  return owners;
}

// Reads balances, the transaction list, confirmations, cancel state and transaction
// hashes for one safe. Pure network work: no React state is touched here.
export async function fetchSafeSnapshot(args: {
  safeReader: any;
  readProvider: any;
  safeAddress: string;
  wallet: string;
  // Previous snapshot from local storage, used to skip re-reading old transactions.
  cached?: any;
  // Background refresh: read only the tail of the list and skip hash lookups.
  silent?: boolean;
}): Promise<SafeSnapshot> {
  const { safeReader, readProvider, safeAddress, wallet, cached, silent } = args;

  // Full balance and free balance are different numbers: the contract reserves the
  // amount of every created transaction in pendingAmount.
  const [bal, availRaw] = await Promise.all([
    readProvider.getBalance(safeAddress),
    safeReader.availableBalance().then(
      (x: bigint) => x,
      () => null
    ),
  ]);

  const balance = ethers.formatUnits(bal, NATIVE_DECIMALS);
  const available =
    availRaw === null || availRaw === undefined ? "" : ethers.formatUnits(availRaw, NATIVE_DECIMALS);

  const items: SafeTx[] = [];
  const cancelMap: Record<number, boolean> = {};
  const sigMap: Record<number, boolean[]> = {};
  const blockMap: TxBlocks = {};

  let count = 0;
  try {
    count = Number(await safeReader.txCount());
  } catch {
    count = 0;
  }
  if (!Number.isFinite(count) || count < 0) count = 0;

  const cachedTxs: any[] = Array.isArray(cached?.txs) ? cached.txs : [];
  const canUseTail =
    !!silent &&
    count > TX_TAIL &&
    cached?.wallet === wallet.toLowerCase() &&
    cachedTxs.length >= count - TX_TAIL;
  const tailStart = canUseTail ? count - TX_TAIL : 0;

  // Ids of transactions below the tail window that are still open and can change.
  const refreshIds: number[] = [];
  if (tailStart > 0) {
    for (const t of cachedTxs) {
      const id = Number(t?.id);
      if (!Number.isFinite(id) || id >= tailStart) continue;
      if (t?.executed || cached?.cancel?.[id]) continue;
      refreshIds.push(id);
    }
    refreshIds.sort((a, b) => a - b);
    // Keep the newest ones if a safe somehow has many open transactions.
    if (refreshIds.length > OPEN_REFRESH_LIMIT)
      refreshIds.splice(0, refreshIds.length - OPEN_REFRESH_LIMIT);
  }

  if (tailStart > 0) {
    // Reuse the cached snapshot for everything below the tail window.
    for (const t of cachedTxs) {
      const id = Number(t?.id);
      if (!Number.isFinite(id) || id >= tailStart) continue;
      items.push({
        id,
        to: t.to,
        amount: BigInt(t.amount),
        executed: !!t.executed,
        confirms: Number(t.confirms),
        cancelVotes: Number(t.cancelVotes || 0),
      });
      cancelMap[id] = !!cached?.cancel?.[id];
      const s = cached?.sigs?.[id];
      sigMap[id] = [!!s?.[0], !!s?.[1], !!s?.[2]];
    }
  }

  for (let base = tailStart; base < count; base += TX_CHUNK) {
    let batch: any[] = [];
    try {
      batch = await safeReader.getTxSummaries(base, Math.min(TX_CHUNK, count - base));
    } catch {
      batch = [];
    }
    for (const v of batch) {
      const id = Number(v?.id);
      if (!Number.isFinite(id)) continue;
      items.push({
        id,
        to: v.to,
        amount: v.amount,
        executed: !!v.executed,
        confirms: Number(v.confirms),
        cancelVotes: Number(v.cancelVoteCount || 0),
      });
      cancelMap[id] = !!v.isCanceled;
      sigMap[id] = [!!v.confirmedBy?.[0], !!v.confirmedBy?.[1], !!v.confirmedBy?.[2]];
      blockMap[id] = {
        created: Number(v.createdBlock),
        executed: Number(v.executedBlock),
      };
    }
  }

  // Neighbouring ids are grouped into ranges, so refreshing open transactions
  // usually costs one extra call rather than one call per transaction.
  if (refreshIds.length) {
    const ranges: Array<{ base: number; len: number }> = [];
    for (const id of refreshIds) {
      const last = ranges[ranges.length - 1];
      if (last && id === last.base + last.len) last.len += 1;
      else ranges.push({ base: id, len: 1 });
    }

    const indexById = new Map<number, number>();
    items.forEach((t, i) => indexById.set(t.id, i));

    for (const r of ranges) {
      let batch: any[] = [];
      try {
        batch = await safeReader.getTxSummaries(r.base, r.len);
      } catch {
        // A failed refresh must not drop a transaction: keep the cached copy.
        batch = [];
      }
      for (const v of batch) {
        const id = Number(v?.id);
        if (!Number.isFinite(id)) continue;
        const fresh: SafeTx = {
          id,
          to: v.to,
          amount: v.amount,
          executed: !!v.executed,
          confirms: Number(v.confirms),
          cancelVotes: Number(v.cancelVoteCount || 0),
        };
        const at = indexById.get(id);
        if (at === undefined) items.push(fresh);
        else items[at] = fresh;
        cancelMap[id] = !!v.isCanceled;
        sigMap[id] = [
          !!v.confirmedBy?.[0],
          !!v.confirmedBy?.[1],
          !!v.confirmedBy?.[2],
        ];
        blockMap[id] = {
          created: Number(v.createdBlock),
          executed: Number(v.executedBlock),
        };
      }
    }

    // Cached rows, tail rows and refreshed rows are merged, so restore id order.
    items.sort((a, b) => a.id - b.id);
  }

  const txHashes: Record<number, string> = {};
  const missingHashes: number[] = [];
  for (const it of items) {
    const h = getStoredTxHash(safeAddress, it.id);
    if (h) txHashes[it.id] = h;
    else missingHashes.push(it.id);
  }

  if (missingHashes.length && !silent) {
    const { created, executed } = await fetchTxHashesByBlocks(safeReader, blockMap, missingHashes);
    for (const it of items) {
      if (txHashes[it.id]) continue;
      const h = it.executed ? executed[it.id] || created[it.id] : created[it.id];
      if (h) {
        txHashes[it.id] = h;
        setStoredTxHash(safeAddress, it.id, h);
      }
    }
  }

  // TxView carries the number of cancel votes but not who cast them. Ask only for the
  // few open transactions that actually have votes.
  const voteIds = items
    .filter((t) => !t.executed && !cancelMap[t.id] && Number(t.cancelVotes || 0) > 0)
    .map((t) => t.id);

  const myCancelVotes: Record<number, boolean> = {};
  if (voteIds.length) {
    const flags = await Promise.all(
      voteIds.map((vid) =>
        safeReader.cancelVoted(vid, wallet).then(
          (x: boolean) => !!x,
          () => false
        )
      )
    );
    voteIds.forEach((vid, i) => {
      myCancelVotes[vid] = flags[i];
    });
  }

  return { balance, available, items, sigMap, cancelMap, myCancelVotes, txHashes };
}
