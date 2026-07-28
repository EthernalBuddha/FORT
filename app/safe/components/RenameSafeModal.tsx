"use client";

import { normAddr } from "../lib/format";
import { Msg, PortalModal } from "./ui";

export default function RenameSafeModal({
  open,
  onClose,
  addr,
  value,
  setValue,
  msg,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  addr: string;
  value: string;
  setValue: (v: string) => void;
  msg: any;
  busy: boolean;
  onSave: (addr: string, name: string) => Promise<boolean>;
}) {
  // Single submit path shared by the Enter key and the Save button.
  async function submit() {
    if (busy) return;
    const a = normAddr(addr);
    if (!a) return;
    const ok = await onSave(a, (value || "").trim());
    if (ok) onClose();
  }

  return (
    <PortalModal
      open={open}
      title="Rename safe"
      onClose={() => {
        if (busy) return;
        onClose();
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
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => setValue(e.target.value.trim())}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />

        <Msg m={msg} />
        <div
          className="row"
          style={{ justifyContent: "space-between", marginTop: 12 }}
        >
          <button
            className="btn"
            onClick={() => void submit()}
            type="button"
            disabled={busy}
          >
            {busy ? "Saving..." : "Save"}
          </button>
          <button
            className="btn"
            onClick={onClose}
            type="button"
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </PortalModal>
  );
}
