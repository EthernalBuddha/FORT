import { ethers } from "ethers";

// Custom errors of Save and SaveFactory. None of them take arguments, so the
// 4-byte selector alone identifies the revert reason.
const ERROR_ABI = [
  "error NotOwner()",
  "error ZeroOwner()",
  "error OwnersMustDiffer()",
  "error BadId()",
  "error BadRecipient()",
  "error EmptyTransaction()",
  "error DataTooLong()",
  "error ExceedsAvailableBalance()",
  "error AlreadyExecuted()",
  "error TransactionCanceled()",
  "error AlreadyConfirmed()",
  "error NotConfirmed()",
  "error NoConfirmations()",
  "error AlreadyVotedToCancel()",
  "error NotVotedToCancel()",
  "error NoCancelVotes()",
  "error NotEnoughConfirmations()",
  "error InsufficientBalance()",
  "error TransferFailed()",
  "error NameTooLong()",
  "error QuorumReached()",
];

const MESSAGES: Record<string, string> = {
  NotOwner: "Only an owner of this safe can do that.",
  ZeroOwner: "Owner address cannot be zero.",
  OwnersMustDiffer: "All three owners must be different addresses.",
  BadId: "No transaction with this id.",
  // The contract reverts with the same selector for the zero address and for the
  // safe itself, so this generic text is used only when the recipient is unknown.
  BadRecipient: "Recipient must be another address, not zero and not this safe.",
  EmptyTransaction: "A transaction needs an amount or calldata.",
  DataTooLong: "Calldata is too long (max 4096 bytes).",
  ExceedsAvailableBalance:
    "Amount exceeds the available balance: the rest is reserved by pending transactions.",
  AlreadyExecuted: "This transaction is already executed.",
  TransactionCanceled: "This transaction is canceled.",
  AlreadyConfirmed: "You already confirmed this transaction.",
  NotConfirmed: "You have not confirmed this transaction.",
  NoConfirmations: "This transaction has no confirmations.",
  AlreadyVotedToCancel: "You already voted to cancel this transaction.",
  NotVotedToCancel: "You have not voted to cancel this transaction.",
  NoCancelVotes: "This transaction has no cancel votes.",
  NotEnoughConfirmations: "Not enough confirmations yet (2 of 3 required).",
  InsufficientBalance: "The safe does not hold enough balance.",
  TransferFailed: "The recipient rejected the transfer, so nothing changed.",
  NameTooLong: "Name is too long (max 32 bytes).",
  QuorumReached:
    "This transaction already has 2 of 3 confirmations and can no longer be canceled. To cancel it, one confirming owner must revoke their confirmation first.",
};

const iface = new ethers.Interface(ERROR_ABI);

// Save.sol reverts with BadRecipient() in two different cases: to == address(0)
// and to == address(this). Both share one 4-byte selector, so the exact reason
// can only come from the recipient the caller tried to use.
export type ContractErrorContext = {
  // The recipient address of the attempted transaction.
  to?: string;
  // The address of the safe the transaction was created on.
  safeAddress?: string;
};

const ZERO_ADDRESS_RE = /^0x0{40}$/;

function badRecipientMessage(ctx?: ContractErrorContext): string {
  const to = (ctx?.to || "").trim().toLowerCase();
  const safe = (ctx?.safeAddress || "").trim().toLowerCase();
  if (to && ZERO_ADDRESS_RE.test(to)) return "Recipient address cannot be zero.";
  if (to && safe && to === safe) return "The safe cannot send to itself.";
  return MESSAGES.BadRecipient;
}

// Revert data hides in a different place depending on which layer threw:
// ethers itself, the wallet, or our RPC proxy.
function revertData(e: any): string | null {
  const candidates = [
    e?.data,
    e?.revert?.data,
    e?.error?.data,
    e?.info?.error?.data,
    e?.data?.data,
    e?.data?.originalError?.data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^0x[0-9a-fA-F]{8}/.test(c)) return c;
  }
  return null;
}

// Returns a human-readable message for a known custom error, or null so the
// caller can fall back to its generic error text.
export function decodeContractError(
  e: any,
  ctx?: ContractErrorContext,
): string | null {
  const data = revertData(e);
  if (!data) return null;
  try {
    const parsed = iface.parseError(data);
    if (!parsed) return null;
    if (parsed.name === "BadRecipient") return badRecipientMessage(ctx);
    return MESSAGES[parsed.name] ?? parsed.name;
  } catch {
    return null;
  }
}
