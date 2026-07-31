import { ethers } from "ethers";

// The factory address is configuration, not source code: it changes on every
// redeploy. It comes from NEXT_PUBLIC_FACTORY_ADDRESS so the value lives in one
// place (.env locally, project settings on Vercel) instead of being duplicated
// across the repo. Next.js inlines NEXT_PUBLIC_* at build time, so the full
// reference below must stay literal - do not rewrite it as a dynamic lookup.
const FACTORY_ADDRESS_RAW = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;

if (!FACTORY_ADDRESS_RAW) {
  throw new Error(
    "NEXT_PUBLIC_FACTORY_ADDRESS is not set. Add it to .env (local) and to the " +
      "project environment variables on Vercel, then rebuild. See .env.example.",
  );
}

// getAddress both validates the EIP-55 checksum and normalises the casing,
// so a typo in the env var fails here with a clear message instead of
// surfacing later as an empty contract call.
let factoryAddressChecked: string;
try {
  factoryAddressChecked = ethers.getAddress(FACTORY_ADDRESS_RAW);
} catch {
  throw new Error(
    `NEXT_PUBLIC_FACTORY_ADDRESS is not a valid address: "${FACTORY_ADDRESS_RAW}"`,
  );
}

export const FACTORY_ADDRESS = factoryAddressChecked;
export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4cef52";

export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const RPC_READ_URL =
  typeof window !== "undefined"
    ? window.location.origin + "/api/rpc"
    : "https://rpc.testnet.arc.network";
export const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

// Cache-bypass header understood by app/api/rpc/route.ts. Reads that carry it
// skip the proxy's in-memory cache and go to the node.
//
// The name is duplicated on purpose: route.ts is a server module and importing
// from it would drag server code into the client bundle. Keep both copies in
// sync - the proxy also reports the name it expects in its GET probe.
export const FRESH_HEADER = "x-fort-fresh";

export const NATIVE_SYMBOL = "USDC";
export const NATIVE_DECIMALS = 18;

// Mirrors Save.THRESHOLD (constant in the contract, cannot change without a
// redeploy). Kept as a plain constant on purpose: components use it during the
// first render, before any network read can have answered.
//
// The value is no longer trusted blindly - checkSafeThreshold below reads the
// real constant from the opened safe and reports a mismatch, which would mean
// NEXT_PUBLIC_FACTORY_ADDRESS points at a different Save version than this UI
// was written for.
export const THRESHOLD = 2;

export const EXPLORER_TX_PREFIX =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_TX || `${ARC_EXPLORER_BASE}/tx/`;

export const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: "Arc Testnet",
  rpcUrls: [ARC_RPC_URL],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: NATIVE_DECIMALS },
  blockExplorerUrls: [ARC_EXPLORER_BASE],
};

export const FACTORY_ABI = [
  // Must match the contract: `save` is indexed, so it lives in topics, not in data.
  "event SaveCreated(address indexed save, address[3] owners)",
  "function createSave(address[3] owners) payable returns (address)",
  // Kept for backwards compatibility with safes listed by older UI code paths.
  // New reads must go through fetchSafesForOwner (paged) below.
  "function getSafesForOwner(address owner) view returns (address[])",
  "function safesCountForOwner(address owner) view returns (uint256)",
  "function getSafesForOwnerPaged(address owner, uint256 offset, uint256 limit) view returns (address[])",
  "function getSafeOwners(address safe) view returns (address[3])",
  "function getSafeName(address safe) view returns (string)",
  "function setSafeName(address safe, string name)",
];

export const SAFE_ABI = [
  "function owners(uint256) view returns (address)",
  // Public constant in Save.sol, so Solidity generates this getter. Read once per
  // safe to verify the THRESHOLD constant above.
  "function THRESHOLD() view returns (uint8)",
  "function txCount() view returns (uint256)",
  "function pendingAmount() view returns (uint256)",
  "function availableBalance() view returns (uint256)",
  "function getTx(uint256 id) view returns (address to, uint256 amount, bool executed, uint8 confirms, bool isCanceled)",
  // Batched read: one request for all transactions, with confirmations and block numbers.
  "function getTxs(uint256 from, uint256 count) view returns (tuple(uint256 id, address to, uint256 amount, bool executed, uint8 confirms, bool isCanceled, address txProposer, uint8 cancelVoteCount, uint64 createdBlock, uint64 executedBlock, bool[3] confirmedBy, bytes data)[])",
  "function getTxSummaries(uint256 from, uint256 count) view returns (tuple(uint256 id, address to, uint256 amount, bool executed, uint8 confirms, bool isCanceled, address txProposer, uint8 cancelVoteCount, uint64 createdBlock, uint64 executedBlock, bool[3] confirmedBy, uint256 dataLength)[])",
  "function getConfirms(uint256 id) view returns (bool[3])",
  "function confirmed(uint256, address) view returns (bool)",
  "function isConfirmed(uint256 id, address owner) view returns (bool)",
  "function canceled(uint256) view returns (bool)",
  "function createTx(address to, uint256 amount) returns (uint256)",
  "function confirmTx(uint256 id)",
  "function revokeConfirm(uint256 id)",
  "function cancelTx(uint256 id)",
  "function revokeCancelVote(uint256 id)",
  "function cancelVoted(uint256, address) view returns (bool)",
  "function executeTx(uint256 id)",
  "event TxCreated(uint256 indexed id, address indexed proposer, address indexed to, uint256 amount)",
  "event TxCancelVoted(uint256 indexed id, address indexed owner, uint8 votes)",
  "event TxCancelVoteRevoked(uint256 indexed id, address indexed owner, uint8 votes)",
  "event TxCanceled(uint256 indexed id, address indexed owner)",
  "event TxExecuted(uint256 indexed id, address indexed executor, address indexed to, uint256 amount)",
];

export function isArc(id: number | string) {
  return Number(id || 0) === ARC_CHAIN_ID;
}

// Single read provider: all reads go through our own /api/rpc proxy,
// not through the wallet and not directly to the public node.
let readProviderSingleton: any = null;

export function getReadProvider() {
  if (!readProviderSingleton) {
    // The /api/rpc proxy handles JSON-RPC batches (2026-07-28): an array is split
    // into single node calls and reassembled with ids preserved.
    // The limit of 10 keeps one proxy queue from handling overly long series.
    readProviderSingleton = new ethers.JsonRpcProvider(RPC_READ_URL, ARC_CHAIN_ID, {
      batchMaxCount: 10,
      staticNetwork: true,
    });
  }
  return readProviderSingleton;
}

// Second read provider, identical to the one above except that every request
// carries FRESH_HEADER. Used for the reads that immediately follow tx.wait():
// the proxy caches eth_call and eth_getBalance for three seconds, which is
// longer than the gap between a mined transaction and the reload after it, so a
// plain read can still answer with pre-transaction state - stale confirmation
// counts, stale balance.
//
// Kept separate instead of flipping a flag on the shared provider: normal reads
// should keep hitting the cache, and a provider's headers are fixed at
// construction time.
let freshReadProviderSingleton: any = null;

export function getFreshReadProvider() {
  if (!freshReadProviderSingleton) {
    const request = new ethers.FetchRequest(RPC_READ_URL);
    request.setHeader(FRESH_HEADER, "1");

    freshReadProviderSingleton = new ethers.JsonRpcProvider(
      request,
      ARC_CHAIN_ID,
      {
        batchMaxCount: 10,
        staticNetwork: true,
      },
    );
  }
  return freshReadProviderSingleton;
}

// Single factory instance bound to the read provider. Every factory read goes through
// it instead of hand-rolled eth_call fetches, so encoding and decoding live in one place.
let factoryReaderSingleton: any = null;

export function getFactoryReader() {
  if (!factoryReaderSingleton) {
    factoryReaderSingleton = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, getReadProvider());
  }
  return factoryReaderSingleton;
}

// Factory reader bound to the fresh provider. Needed right after createSafe:
// a cached safes list would not yet contain the safe that was just deployed.
let freshFactoryReaderSingleton: any = null;

export function getFreshFactoryReader() {
  if (!freshFactoryReaderSingleton) {
    freshFactoryReaderSingleton = new ethers.Contract(
      FACTORY_ADDRESS,
      FACTORY_ABI,
      getFreshReadProvider(),
    );
  }
  return freshFactoryReaderSingleton;
}

// Reads Save.THRESHOLD from an opened safe. The value is a contract constant, so
// one read per safe address is enough for the lifetime of the page.
const thresholdCache = new Map<string, number>();

export async function readSafeThreshold(
  safeAddress: string,
  provider?: any,
): Promise<number> {
  const key = safeAddress.toLowerCase();
  const cached = thresholdCache.get(key);
  if (cached !== undefined) return cached;

  const safe: any = new ethers.Contract(
    safeAddress,
    SAFE_ABI,
    provider || getReadProvider(),
  );
  const onChain = Number(await safe.THRESHOLD());
  if (!Number.isFinite(onChain) || onChain <= 0) {
    throw new Error(`Safe ${safeAddress} reported an unusable THRESHOLD`);
  }

  thresholdCache.set(key, onChain);
  return onChain;
}

// Compares the on-chain constant with the THRESHOLD used by this UI.
//
// A mismatch is not cosmetic: the quorum drives which buttons are offered, so a
// UI expecting 2 against a contract wanting 3 would show Execute on a
// transaction that reverts with NotEnoughConfirmations, and hide Cancel on a
// transaction that could still be canceled.
//
// A failed read is reported as ok: the network being unavailable must not stop a
// safe from opening, and the check simply retries on the next load.
export async function checkSafeThreshold(
  safeAddress: string,
  provider?: any,
): Promise<{ ok: boolean; onChain: number | null }> {
  try {
    const onChain = await readSafeThreshold(safeAddress, provider);
    return { ok: onChain === THRESHOLD, onChain };
  } catch {
    return { ok: true, onChain: null };
  }
}

// Page size for reading the owner's safes. The contract clamps offset/limit to
// the remaining items, so the last page is simply shorter and never reverts.
// 50 keeps a typical owner at one or two calls while staying far away from the
// eth_call gas limit that an unbounded getSafesForOwner would eventually hit.
export const SAFES_PAGE_SIZE = 50;

// Reads the full list of safes for an owner page by page.
// Replaces the unbounded getSafesForOwner call: the array is no longer built in
// a single response, so a large number of safes cannot blow up the eth_call.
// Pass fresh: true when the list is read right after a safe was created, so the
// proxy cache is bypassed instead of answering with the previous list.
export async function fetchSafesForOwner(
  owner: string,
  fresh = false,
): Promise<string[]> {
  const factory = fresh ? getFreshFactoryReader() : getFactoryReader();

  const total = Number(await factory.safesCountForOwner(owner));
  if (!total) return [];

  const out: string[] = [];
  for (let offset = 0; offset < total; offset += SAFES_PAGE_SIZE) {
    const page: string[] = await factory.getSafesForOwnerPaged(
      owner,
      offset,
      SAFES_PAGE_SIZE,
    );
    // Defensive stop: an empty page means the list shrank between calls
    // (a safe created concurrently cannot shrink it, but a stale cache can),
    // and continuing would loop until `total` for nothing.
    if (!page.length) break;
    out.push(...page);
  }

  return out;
}

// Reads only the most recently created safe of an owner.
// Used as a fallback when the SaveCreated event cannot be recovered from the
// receipt: pulling the whole list just to take its last element would grow with
// the number of safes, so the count is read first and a single-item page is
// requested at the tail. Two calls, regardless of how many safes exist.
// Returns null when the owner has no safes.
export async function fetchLatestSafeForOwner(
  owner: string,
  fresh = false,
): Promise<string | null> {
  const factory = fresh ? getFreshFactoryReader() : getFactoryReader();

  const total = Number(await factory.safesCountForOwner(owner));
  if (!total) return null;

  const page: string[] = await factory.getSafesForOwnerPaged(
    owner,
    total - 1,
    1,
  );

  return page.length ? page[0] : null;
}

export function txUrl(hash: string) {
  const h = (hash || "").trim();
  if (!h) return "";
  const p = (EXPLORER_TX_PREFIX || "").trim();
  if (!p) return "";
  return p.endsWith("/") ? p + h : p + "/" + h;
}
