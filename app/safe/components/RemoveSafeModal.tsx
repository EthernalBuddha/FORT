"use client";

import { PortalModal } from "./ui";

export default function RemoveSafeModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <PortalModal
      open={open}
      title="Remove safe"
      onClose={onClose}
      width="min(360px, calc(100vw - 36px))"
      showClose={false}
    >
      <div className="stackSm" style={{ padding: 2 }}>
        <div
          className="row"
          style={{ justifyContent: "space-between", marginTop: 12 }}
        >
          <button
            className="btn"
            onClick={onConfirm}
            type="button"
            style={{
              border: "1px solid rgba(255, 95, 115, 0.45)",
              background: "rgba(255, 95, 115, 0.12)",
            }}
          >
            Remove
          </button>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </PortalModal>
  );
}
