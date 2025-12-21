"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const FACTORY_ADDRESS =
  "0x48e74d27F7af48D97f96Ef0A441244111893Eaf2";

const FACTORY_ABI = [
  "event SaveCreated(address save, address[3] owners)",
  "function createSave(address[3] owners) payable returns (address)",
];

const SAFE_ABI = [
  "function owners(uint256) view returns (address)",
  "function txs(uint256) view returns (address to, uint256 amount, bool executed, uint8 confirms)",
  "function createTx(address to, uint256 amount) returns (uint256)",
  "function confirmTx(uint256 id)",
  "function executeTx(uint256 id)",
];

export default function Page() {
  const [wallet, setWallet] = useState("");
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);

  const [owner1, setOwner1] = useState("");
  const [owner2, setOwner2] = useState("");
  const [owner3, setOwner3] = useState("");

  const [safeAddress, setSafeAddress] = useState("");
  const [safeContract, setSafeContract] = useState(null);

  const [owners, setOwners] = useState([]);
  const [balance, setBalance] = useState("0");
  const [txs, setTxs] = useState([]);

  const [txTo, setTxTo] = useState("");
  const [txAmount, setTxAmount] = useState("");

  const [ownerIndex, setOwnerIndex] = useState(-1);

  async function ensureWallet() {
    if (signer && provider) return { provider, signer };
    if (!window.ethereum) throw new Error("No wallet detected");

    const p = new ethers.BrowserProvider(window.ethereum);
    const s = await p.getSigner();
    const addr = await s.getAddress();

    setProvider(p);
    setSigner(s);
    setWallet(addr);

    return { provider: p, signer: s };
  }

  // ✔️ ОБНОВЛЕННАЯ connectWallet()
  async function connectWallet() {
    try {
      await ensureWallet();
      console.log("Wallet connected OK");
    } catch (e) {
      console.error("CONNECT ERROR:", e);
      alert("ERROR: " + e.message);
    }
  }

  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.on("accountsChanged", async (acc) => {
      if (!acc[0]) return;
      const p = new ethers.BrowserProvider(window.ethereum);
      const s = await p.getSigner();
      setProvider(p);
      setSigner(s);
      setWallet(acc[0]);
      if (safeAddress) loadSafe(safeAddress);
    });
  }, [safeAddress]);

  async function createSafe() {
    try {
      const { signer } = await ensureWallet();

      const arr = [owner1.trim(), owner2.trim(), owner3.trim()];
      for (const o of arr) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(o)) {
          alert("Invalid owner: " + o);
          return;
        }
      }

      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        signer
      );

      const tx = await factory.createSave(arr, { value: 0n });
      const receipt = await tx.wait();

      const iface = new ethers.Interface(FACTORY_ABI);
      let created = null;

      for (const log of receipt.logs) {
        try {
          const p = iface.parseLog(log);
          if (p && p.name === "SaveCreated") {
            created = p.args.save;
            break;
          }
        } catch {}
      }

      if (!created) {
        alert("Safe created but not found in logs");
        return;
      }

      setSafeAddress(created);
      await loadSafe(created);
      alert("Safe: " + created);
    } catch (e) {
      console.error(e);
      alert("Create safe failed");
    }
  }

  async function loadSafe(addr) {
    try {
      const { provider, signer } = await ensureWallet();
      const safe = new ethers.Contract(addr, SAFE_ABI, signer);

      setSafeContract(safe);
      setSafeAddress(addr);

      const ownersArr = [];
      for (let i = 0; i < 3; i++) {
        try {
          ownersArr.push(await safe.owners(i));
        } catch {
          ownersArr.push("0x0000000000000000000000000000000000000000");
        }
      }
      setOwners(ownersArr);

      let idx = -1;
      ownersArr.forEach((o, i) => {
        if (wallet && o.toLowerCase() === wallet.toLowerCase()) idx = i;
      });
      setOwnerIndex(idx);

      const bal = await provider.getBalance(addr);
      setBalance(ethers.formatEther(bal));

      const items = [];
      for (let i = 0; i < 1000; i++) {
        try {
          const t = await safe.txs(i);
          items.push({
            id: i,
            to: t.to,
            amount: t.amount,
            executed: t.executed,
            confirms: Number(t.confirms),
          });
        } catch {
          break;
        }
      }
      setTxs(items);
    } catch (e) {
      console.error(e);
      alert("Load safe failed");
    }
  }

  async function createTx() {
    try {
      if (!safeContract) return alert("Load safe");
      if (!txTo || !txAmount) return alert("Fill fields");

      const value = ethers.parseEther(txAmount);
      const tx = await safeContract.createTx(txTo, value);
      await tx.wait();
      await loadSafe(safeAddress);
    } catch (e) {
      console.error(e);
      alert("Create TX failed");
    }
  }

  async function confirmTx(id) {
    try {
      if (!safeContract) return;
      const tx = await safeContract.confirmTx(id);
      await tx.wait();
      await loadSafe(safeAddress);
    } catch (e) {
      console.error(e);
      alert("Confirm failed");
    }
  }

  async function executeTx(id) {
    try {
      if (!safeContract) return;
      const tx = await safeContract.executeTx(id);
      await tx.wait();
      await loadSafe(safeAddress);
    } catch (e) {
      console.error(e);
      alert("Execute failed");
    }
  }

  function renderAmount(a) {
    if (!a) return "0";
    try {
      return ethers.formatEther(a);
    } catch {
      return "0";
    }
  }

  function copy(x) {
    navigator.clipboard.writeText(x);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: "24px",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "40px", marginBottom: "8px" }}>
        ArcSafe
      </h1>

      <div style={{ marginBottom: "16px" }}>
        <button onClick={connectWallet} style={{ marginRight: "12px" }}>
          Connect
        </button>

        <button
          onClick={() =>
            window.ethereum.request({
              method: "wallet_requestPermissions",
              params: [{ eth_accounts: {} }],
            })
          }
          style={{ marginRight: "12px" }}
        >
          Switch
        </button>

        <span>Wallet: {wallet || "not connected"}</span>
      </div>

      <div
        style={{
          border: "1px solid #444",
          padding: "16px",
          maxWidth: "900px",
          marginBottom: "24px",
        }}
      >
        <h2>Create Safe</h2>
        <input
          placeholder="Owner 1"
          value={owner1}
          onChange={(e) => setOwner1(e.target.value)}
          style={{ width: "100%", marginBottom: "4px" }}
        />
        <input
          placeholder="Owner 2"
          value={owner2}
          onChange={(e) => setOwner2(e.target.value)}
          style={{ width: "100%", marginBottom: "4px" }}
        />
        <input
          placeholder="Owner 3"
          value={owner3}
          onChange={(e) => setOwner3(e.target.value)}
          style={{ width: "100%", marginBottom: "8px" }}
        />
        <button onClick={createSafe}>Create Safe</button>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <input
          placeholder="Safe address"
          value={safeAddress}
          onChange={(e) => setSafeAddress(e.target.value)}
          style={{ width: "400px" }}
        />
        <button onClick={() => loadSafe(safeAddress)} style={{ marginLeft: "8px" }}>
          Load Safe
        </button>
      </div>

      <h2>Owners</h2>

      {ownerIndex >= 0 ? (
        <div style={{ color: "#0f0", marginBottom: "6px" }}>
          You are: Owner #{ownerIndex + 1}
        </div>
      ) : (
        <div style={{ color: "#888", marginBottom: "6px" }}>
          You are not an owner
        </div>
      )}

      {owners.length === 0 && <div>No owners</div>}

      {owners.map((o, i) => (
        <div
          key={i}
          style={{
            marginBottom: "4px",
            color:
              wallet.toLowerCase() === o.toLowerCase()
                ? "#0f0"
                : "#fff",
          }}
        >
          {o}{" "}
          <button
            onClick={() => copy(o)}
            style={{
              marginLeft: "8px",
              fontSize: "11px",
              padding: "2px 6px",
            }}
          >
            copy
          </button>
        </div>
      ))}

      <h2 style={{ marginTop: "24px" }}>Balance</h2>
      <div>{balance} ETH</div>

      <h2 style={{ marginTop: "24px" }}>Create TX</h2>
      <input
        placeholder="to"
        value={txTo}
        onChange={(e) => setTxTo(e.target.value)}
        style={{ width: "400px", marginRight: "8px" }}
      />
      <input
        placeholder="amount"
        value={txAmount}
        onChange={(e) => setTxAmount(e.target.value)}
        style={{ width: "120px", marginRight: "8px" }}
      />
      <button onClick={createTx}>Create TX</button>

      <h2 style={{ marginTop: "24px" }}>Transactions</h2>
      {txs.length === 0 && <div>No transactions</div>}

      {txs.map((t) => (
        <div
          key={t.id}
          style={{
            border: "1px solid #444",
            padding: "8px 10px",
            marginBottom: "10px",
            maxWidth: "900px",
          }}
        >
          <div>
            <b>ID {t.id}</b> → {t.to}, {renderAmount(t.amount)} ETH
          </div>
          <div>confirms: {t.confirms} / 3</div>
          <div>executed: {String(t.executed)}</div>

          {!t.executed && (
            <div style={{ marginTop: "6px" }}>
              <button onClick={() => confirmTx(t.id)}>Confirm</button>

              {t.confirms >= 2 && (
                <button
                  onClick={() => executeTx(t.id)}
                  style={{
                    marginLeft: "8px",
                    background: "#0a0",
                    color: "#fff",
                  }}
                >
                  Execute
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
