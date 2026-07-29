"use client";

import { ethers } from "ethers";

import { NATIVE_DECIMALS, NATIVE_SYMBOL, THRESHOLD } from "../lib/chain";
import { short } from "../lib/format";
import { Msg } from "./ui";
import type { SafeTx } from "../lib/safeData";

export type TxActionState = { id: number; action: string } | null;

export type TxCardProps = {
  tx: SafeTx;
  owners: string[];
  // Index of the connected wallet inside owners, or -1.
  ownerIndex: number;
  // Confirmation flag per owner slot.
  sigs: boolean[];
  msg?: any;
  isCanceled: boolean;
  // Whether the connected owner already voted to cancel.
  iVotedCancel: boolean;
  // Explorer link for this transaction, empty when the hash is unknown.
  explorerUrl: string;
  // Action currently running, used to disable the whole row.
  txAction: TxActionState;
  onConfirm: (id: number) => void;
  onRevokeConfirm: (id: number) => void;
  onExecute: (id: number) => void;
  onCancel: (id: number) => void;
  onRevokeCancelVote: (id: number) => void;
};

export function TxCard({
  tx,
  owners,
  ownerIndex,
  sigs,
  msg,
  isCanceled,
  iVotedCancel,
  explorerUrl,
  txAction,
  onConfirm,
  onRevokeConfirm,
  onExecute,
  onCancel,
  onRevokeCancelVote,
}: TxCardProps) {
  const isConfirming = txAction?.id === tx.id && txAction?.action === "confirm";
  const isExecuting = txAction?.id === tx.id && txAction?.action === "execute";
  const isRevoking = txAction?.id === tx.id && txAction?.action === "revoke";
  const isCanceling = txAction?.id === tx.id && txAction?.action === "cancel";
  const isRevokingCancel = txAction?.id === tx.id && txAction?.action === "revokeCancel";
  const disableRow = !!txAction;

  // Cancellation needs THRESHOLD votes, so votes are shown like confirmations.
  const cancelVotes = Number(tx.cancelVotes || 0);

  // After quorum the contract reverts cancelTx with QuorumReached, so this
  // button could only burn a wallet signature.
  const cancelBlockedByQuorum =
    !tx.executed && !isCanceled && tx.confirms >= THRESHOLD;
  const meConfirmed = ownerIndex >= 0 ? !!sigs[ownerIndex] : false;

  const statusText = tx.executed
    ? null
    : isCanceled
      ? "Canceled"
      : tx.confirms >= THRESHOLD
        ? "Ready to execute"
        : `Waiting for confirmations ${Math.max(0, tx.confirms)}/${THRESHOLD}`;

  const statusIcon = tx.executed ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(80,220,170,0.6)"
      strokeWidth="3"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : null;

  return (
    <div className={`txItem ${isCanceled ? "txCanceled" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 780, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            TX {tx.id}
            {isCanceled ? (
              <span className="chip chipCanceled" style={{ padding: "4px 10px", fontSize: 12 }}>
                Canceled
              </span>
            ) : null}
            {statusIcon ? (
              <span style={{ display: "inline-flex", alignItems: "center" }}>{statusIcon}</span>
            ) : (
              <span
                className={`muted ${statusText?.startsWith("Waiting") ? "blinkText" : ""}`}
                style={{ fontWeight: 600, textTransform: "uppercase" }}
              >
                • {statusText}
              </span>
            )}
          </div>

          <div style={{ fontSize: 14 }}>
            {ethers.formatUnits(tx.amount, NATIVE_DECIMALS)} {NATIVE_SYMBOL} → {short(tx.to)}
          </div>

          <div className="muted" style={{ fontSize: 13, textTransform: "uppercase" }}>
            Signatures: {tx.confirms}/{THRESHOLD}
          </div>

          {!tx.executed && !isCanceled && cancelVotes > 0 ? (
            <div className="muted" style={{ fontSize: 13, textTransform: "uppercase" }}>
              Cancel votes: {cancelVotes}/{THRESHOLD}
            </div>
          ) : null}

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
                    ...(me && ok
                      ? {
                          background: "rgba(80,220,170,0.1)",
                          borderColor: "rgba(80,220,170,0.5)",
                          fontWeight: 700,
                        }
                      : {}),
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
          {!tx.executed && !isCanceled ? (
            <>
              {meConfirmed ? (
                <button
                  className="btn btnDanger"
                  onClick={() => onRevokeConfirm(tx.id)}
                  disabled={disableRow}
                  type="button"
                  title="Revoke your confirmation"
                >
                  {isRevoking ? "Revoking…" : "Revoke"}
                </button>
              ) : (
                <button
                  className="btn"
                  onClick={() => onConfirm(tx.id)}
                  disabled={disableRow}
                  type="button"
                  title="Confirm"
                >
                  {isConfirming ? "Confirming…" : "Confirm"}
                </button>
              )}
              {tx.confirms >= THRESHOLD ? (
                <button
                  className="btn btnOk"
                  onClick={() => onExecute(tx.id)}
                  disabled={disableRow}
                  type="button"
                >
                  {isExecuting ? "Executing…" : "Execute"}
                </button>
              ) : null}
              {iVotedCancel ? (
                <button
                  className="btn"
                  onClick={() => onRevokeCancelVote(tx.id)}
                  disabled={disableRow}
                  type="button"
                  title="Take back your vote to cancel this transaction"
                >
                  {isRevokingCancel ? "Revoking…" : "Revoke cancel vote"}
                </button>
              ) : (
                <button
                  className="btn btnCancel"
                  onClick={() => onCancel(tx.id)}
                  disabled={disableRow || cancelBlockedByQuorum}
                  type="button"
                  title={
                    cancelBlockedByQuorum
                      ? "Blocked: quorum reached. One confirming owner must revoke their confirmation first."
                      : `Cancellation needs ${THRESHOLD} owner votes`
                  }
                >
                  {isCanceling
                    ? "Voting…"
                    : cancelVotes > 0
                      ? `Vote to cancel (${cancelVotes}/${THRESHOLD})`
                      : "Cancel"}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {msg ? <Msg m={msg} /> : null}

      {explorerUrl ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <a
            href={explorerUrl}
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
}
