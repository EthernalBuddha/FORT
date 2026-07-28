import { ethers } from "ethers";

export function normAddr(x: string) {
  const a = (x || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return null;
  try {
    return ethers.getAddress(a);
  } catch {
    return null;
  }
}

export function short(a: string) {
  if (!a) return "";
  return a.slice(0, 6) + "..." + a.slice(-4);
}

export function errText(e: any) {
  if (e?.code === "TIMEOUT") return "Wallet request timed out. Open wallet and confirm.";
  if (e?.code === -32002) return "Wallet request already pending. Open wallet.";
  if (e?.code === 4001) return "Request rejected in wallet.";
  return (
    e?.shortMessage ||
    e?.reason ||
    e?.info?.error?.message ||
    e?.data?.message ||
    e?.message ||
    (typeof e === "string" ? e : "") ||
    "Unknown error"
  );
}

export function isAddChainErr(e: any) {
  const code =
    e?.code ??
    e?.data?.originalError?.code ??
    e?.data?.code ??
    e?.error?.code ??
    e?.info?.error?.code ??
    e?.info?.error?.data?.originalError?.code;

  if (code === 4902) return true;

  const msg = String(
    e?.shortMessage ||
      e?.message ||
      e?.info?.error?.message ||
      e?.data?.message ||
      e?.data?.originalError?.message ||
      ""
  ).toLowerCase();

  if (!msg) return false;

  return (
    msg.includes("unrecognized chain") ||
    msg.includes("unknown chain") ||
    msg.includes("chain is not added") ||
    (msg.includes("not added") && msg.includes("chain")) ||
    msg.includes("add ethereum chain") ||
    msg.includes("wallet_addethereumchain")
  );
}

export function setSafeParamInUrl(a: string, name: string) {
  try {
    const u = new URL(window.location.href);
    if (a) u.searchParams.set("safe", a);
    else u.searchParams.delete("safe");

    const n = (name || "").trim();
    if (a && n) u.searchParams.set("name", n);
    else u.searchParams.delete("name");

    window.history.replaceState({}, "", u.toString());
  } catch {}
}
