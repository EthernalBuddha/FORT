import { normAddr } from "./format";

const NAME_PREFIX = "arcsafe:safeName:";
const SAFES_BY_WALLET_PREFIX = "arcsafe:safesByWallet:";
const TXHASH_PREFIX = "arcsafe:txHash:";
const HIDDEN_SAFES_PREFIX = "arcsafe:hiddenSafes:";
const SAFE_CACHE_PREFIX = "arcsafe:safeCache:";

export const CONNECTED_WALLET_KEY = "arcsafe:connectedWallet";

export function getStoredName(addr: string) {
  try {
    if (!addr) return "";
    return localStorage.getItem(NAME_PREFIX + addr.toLowerCase()) || "";
  } catch {
    return "";
  }
}

export function setStoredName(addr: string, name: string) {
  try {
    if (!addr) return;
    const key = NAME_PREFIX + addr.toLowerCase();
    const v = (name || "").trim();
    if (!v) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {}
}

export function parseSafesRaw(raw: string) {
  const out: string[] = [];
  const push = (v: string) => {
    const a = normAddr(v);
    if (!a) return;
    if (!out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  };

  if (!raw || typeof raw !== "string") return out;

  const s = raw.trim();
  if (!s) return out;

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      parsed.forEach((x) => push(typeof x === "string" ? x : ""));
      return out;
    }
  } catch {}

  const matches = s.match(/0x[a-fA-F0-9]{40}/g);
  if (matches && matches.length) {
    matches.forEach((m) => push(m));
    return out;
  }

  s.split(/[\s,;|]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((x) => push(x));

  return out;
}

export function getSafesForWallet(wallet: string) {
  try {
    if (!wallet) return [] as string[];
    const key = SAFES_BY_WALLET_PREFIX + wallet.toLowerCase();
    const raw = localStorage.getItem(key) || "";
    const arr = parseSafesRaw(raw);

    const looksJson = raw.trim().startsWith("[");
    if (raw && !looksJson) {
      try {
        localStorage.setItem(key, JSON.stringify(arr));
      } catch {}
    }

    return arr;
  } catch {
    return [] as string[];
  }
}

export function addSafeForWallet(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;

    const key = SAFES_BY_WALLET_PREFIX + w;
    const cur = getSafesForWallet(wallet);

    const exists = cur.some((x) => x.toLowerCase() === s.toLowerCase());
    const next = exists ? cur : [s, ...cur];

    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

// Drops a safe from the wallet's local list and returns the remaining ones.
export function removeSafeFromWallet(wallet: string, safe: string): string[] {
  try {
    const w = normAddr(wallet);
    const s = normAddr(safe);
    if (!w || !s) return getSafesForWallet(wallet);

    const next = getSafesForWallet(w).filter((x) => x.toLowerCase() !== s.toLowerCase());
    localStorage.setItem(SAFES_BY_WALLET_PREFIX + w.toLowerCase(), JSON.stringify(next));
    return next;
  } catch {
    return getSafesForWallet(wallet);
  }
}

export function getHiddenSafes(wallet: string): string[] {
  try {
    const w = (wallet || "").toLowerCase();
    if (!w) return [];
    const raw = localStorage.getItem(HIDDEN_SAFES_PREFIX + w);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x: string) => x.toLowerCase()) : [];
  } catch {
    return [];
  }
}

export function hideSafe(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;
    const hidden = getHiddenSafes(wallet);
    if (!hidden.includes(s.toLowerCase())) {
      hidden.push(s.toLowerCase());
      localStorage.setItem(HIDDEN_SAFES_PREFIX + w, JSON.stringify(hidden));
    }
  } catch {}
}

export function unhideSafe(wallet: string, safe: string) {
  try {
    const w = (wallet || "").toLowerCase();
    const s = normAddr(safe);
    if (!w || !s) return;
    const hidden = getHiddenSafes(wallet);
    const next = hidden.filter((x) => x !== s.toLowerCase());
    localStorage.setItem(HIDDEN_SAFES_PREFIX + w, JSON.stringify(next));
  } catch {}
}

export function isSafeHidden(wallet: string, safe: string): boolean {
  const s = normAddr(safe);
  if (!s) return false;
  return getHiddenSafes(wallet).includes(s.toLowerCase());
}

export function getStoredTxHash(safe: string, id: number) {
  try {
    const s = normAddr(safe);
    const i = Number(id);
    if (!s || !Number.isFinite(i) || i < 0) return "";
    return localStorage.getItem(`${TXHASH_PREFIX}${s.toLowerCase()}:${i}`) || "";
  } catch {
    return "";
  }
}

export function setStoredTxHash(safe: string, id: number, hash: string) {
  try {
    const s = normAddr(safe);
    const i = Number(id);
    const h = (hash || "").trim();
    if (!s || !Number.isFinite(i) || i < 0 || !h) return;
    localStorage.setItem(`${TXHASH_PREFIX}${s.toLowerCase()}:${i}`, h);
  } catch {}
}

// The cache key includes the wallet: two owners sharing one browser must not
// overwrite each other's snapshot. `v` drops snapshots written by an older shape
// of this file, `at` expires stale data.
const SAFE_CACHE_VERSION = 2;
const SAFE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function safeCacheKey(safe: string, wallet: string) {
  const s = normAddr(safe);
  const w = (wallet || "").toLowerCase();
  if (!s || !w) return "";
  return `${SAFE_CACHE_PREFIX}${s.toLowerCase()}:${w}`;
}

export function getSafeCache(safe: string, wallet: string): any {
  try {
    const key = safeCacheKey(safe, wallet);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SAFE_CACHE_VERSION) {
      localStorage.removeItem(key);
      return null;
    }
    if (!Number.isFinite(parsed.at) || Date.now() - parsed.at > SAFE_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSafeCache(safe: string, wallet: string, data: any) {
  try {
    const key = safeCacheKey(safe, wallet);
    if (!key) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        v: SAFE_CACHE_VERSION,
        at: Date.now(),
        wallet: (wallet || "").toLowerCase(),
        ...data,
      })
    );
  } catch {}
}
