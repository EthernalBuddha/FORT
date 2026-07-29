import { ethers } from "ethers";

const FACTORY_ADDRESS_RAW = "0xc965e062f93F35507DF0F9E9a3973F04704215dA";

export const FACTORY_ADDRESS = ethers.getAddress(FACTORY_ADDRESS_RAW);
export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4cef52";

export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const RPC_READ_URL =
  typeof window !== "undefined"
    ? window.location.origin + "/api/rpc"
    : "https://rpc.testnet.arc.network";
export const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

export const NATIVE_SYMBOL = "USDC";
export const NATIVE_DECIMALS = 18;

// Mirrors Save.THRESHOLD (constant in the contract, cannot change without a
// redeploy). Verify this value together with FACTORY_ADDRESS_RAW above.
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
  "function getSafesForOwner(address owner) view returns (address[])",
  "function getSafeOwners(address safe) view returns (address[3])",
  "function getSafeName(address safe) view returns (string)",
  "function setSafeName(address safe, string name)",
];

export const SAFE_ABI = [
  "function owners(uint256) view returns (address)",
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

// Single factory instance bound to the read provider. Every factory read goes through
// it instead of hand-rolled eth_call fetches, so encoding and decoding live in one place.
let factoryReaderSingleton: any = null;

export function getFactoryReader() {
  if (!factoryReaderSingleton) {
    factoryReaderSingleton = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, getReadProvider());
  }
  return factoryReaderSingleton;
}

export function txUrl(hash: string) {
  const h = (hash || "").trim();
  if (!h) return "";
  const p = (EXPLORER_TX_PREFIX || "").trim();
  if (!p) return "";
  return p.endsWith("/") ? p + h : p + "/" + h;
}
