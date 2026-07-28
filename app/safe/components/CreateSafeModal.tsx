"use client";

import { Msg, PortalModal } from "./ui";

export default function CreateSafeModal({
  open,
  onClose,
  step,
  setStep,
  name,
  setName,
  owner1,
  setOwner1,
  owner2,
  setOwner2,
  owner3,
  setOwner3,
  msg,
  busy,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  step: number;
  setStep: (v: number) => void;
  name: string;
  setName: (v: string) => void;
  owner1: string;
  setOwner1: (v: string) => void;
  owner2: string;
  setOwner2: (v: string) => void;
  owner3: string;
  setOwner3: (v: string) => void;
  msg: any;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <PortalModal
      open={open}
      title="Create new safe"
      onClose={onClose}
      width="min(620px, calc(100vw - 36px))"
    >
      <div className="stackSm" style={{ padding: 2 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Step {step + 1} / 2
        </div>

        {step === 0 ? (
          <>
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Name
            </div>
            <input
              placeholder="My Fort"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setStep(1);
              }}
            />
            <div
              className="row"
              style={{ justifyContent: "flex-end", marginTop: 12 }}
            >
              <button className="btn" onClick={() => setStep(1)} type="button">
                Next
              </button>
            </div>
            <Msg m={msg} />
          </>
        ) : (
          <>
            <div
              className="muted"
              style={{
                fontSize: 12,
                marginTop: 10,
                textTransform: "uppercase",
              }}
            >
              Owners (3)
            </div>
            <input
              placeholder="Owner 1"
              value={owner1}
              onChange={(e) => setOwner1(e.target.value)}
              onBlur={(e) => setOwner1(e.target.value.trim())}
            />
            <input
              placeholder="Owner 2"
              value={owner2}
              onChange={(e) => setOwner2(e.target.value)}
              onBlur={(e) => setOwner2(e.target.value.trim())}
            />
            <input
              placeholder="Owner 3"
              value={owner3}
              onChange={(e) => setOwner3(e.target.value)}
              onBlur={(e) => setOwner3(e.target.value.trim())}
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
                {busy ? "Creating…" : "Create"}
              </button>
              <button
                className="btn"
                onClick={() => setStep(0)}
                disabled={busy}
                type="button"
              >
                Back
              </button>
            </div>

            <Msg m={msg} />
          </>
        )}
      </div>
    </PortalModal>
  );
}