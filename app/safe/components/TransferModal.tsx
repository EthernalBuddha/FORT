"use client";

import { NATIVE_SYMBOL } from "../lib/chain";
import { Msg, PortalModal } from "./ui";

export default function TransferModal({
  open,
  onClose,
  to,
  setTo,
  amount,
  setAmount,
  msg,
  busy,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  to: string;
  setTo: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  msg: any;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <PortalModal
      open={open}
      title="New transfer"
      onClose={onClose}
      width="min(560px, calc(100vw - 36px))"
      showClose={false}
    >
      <div className="stackSm" style={{ padding: 2 }}>
        <div
          className="muted"
          style={{ fontSize: 12, marginTop: 10, textTransform: "uppercase" }}
        >
          Recipient
        </div>
        <input
          placeholder="0x..."
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onBlur={(e) => setTo(e.target.value.trim())}
        />

        <div
          className="muted"
          style={{ fontSize: 12, textTransform: "uppercase" }}
        >
          Amount ({NATIVE_SYMBOL})
        </div>
        <input
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={(e) => setAmount(e.target.value.trim())}
        />

        <div
          className="row"
          style={{ justifyContent: "space-between", marginTop: 12 }}
        >
          <button
            className="btn btnOk"
            onClick={onCreate}
            disabled={busy}
            type="button"
          >
            {busy ? "Submitting…" : "Create"}
          </button>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
        </div>

        <Msg m={msg} />
      </div>
    </PortalModal>
  );
}
