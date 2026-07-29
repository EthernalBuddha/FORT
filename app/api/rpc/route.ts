import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const MIN_INTERVAL_MS = 120;
const MAX_ATTEMPTS = 3;

// Keep five seconds between the application deadline and the platform limit.
const POST_DEADLINE_MS = 25_000;

// Hard limits. Without them this route is an open relay: anybody can point their
// wallet at our domain and spend the node's rate limit, and a single oversized
// batch can hold the function until the platform timeout kills it.
const MAX_BODY_BYTES = 128 * 1024;
const MAX_BATCH_ITEMS = 20;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_CACHE_ENTRIES = 500;

const CACHE_TTL_MS = {
  forever: Infinity,
  long: 5 * 60 * 1000,
  short: 3 * 1000,
} as const;

// Only the read methods this app actually uses. eth_sendRawTransaction is
// deliberately absent: the wallet talks to the node directly when signing.
const ALLOWED_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "net_version",
]);

const CACHEABLE_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "net_version",
]);

let lastCallAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RpcId = string | number | null;
type RpcObject = Record<string, unknown>;

type CacheEntry = {
  result: unknown;
  expiresAt: number;
};

type UpstreamResult = {
  status: number;
  text: string;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RpcObject>>();

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function deadlineError(id: RpcId = null) {
  return rpcError(id, -32005, "proxy deadline exceeded");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function deadlineUpstreamResult(): UpstreamResult {
  console.error("[rpc-proxy] request deadline exceeded");

  return {
    status: 200,
    text: JSON.stringify(deadlineError()),
  };
}

function remainingTime(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

async function sleepWithinDeadline(
  milliseconds: number,
  deadlineAt: number
): Promise<boolean> {
  const remaining = remainingTime(deadlineAt);

  if (remaining <= 0) {
    return false;
  }

  await sleep(Math.min(milliseconds, remaining));

  return Date.now() < deadlineAt;
}

function paramsOf(item: unknown): unknown {
  if (!item || typeof item !== "object") return [];
  return (item as Record<string, unknown>).params ?? [];
}

function getCacheKey(method: string, params: unknown): string {
  return `${method}|${JSON.stringify(params)}`;
}

function isFixedBlockTag(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-f]+$/i.test(value);
}

function isFixedLogsRequest(params: unknown): boolean {
  if (!Array.isArray(params) || !params[0] || typeof params[0] !== "object") {
    return false;
  }

  const filter = params[0] as Record<string, unknown>;

  if (typeof filter.blockHash === "string") {
    return true;
  }

  return (
    isFixedBlockTag(filter.fromBlock) &&
    isFixedBlockTag(filter.toBlock) &&
    filter.fromBlock === filter.toBlock
  );
}

function getCacheTtl(method: string, params: unknown, result: unknown): number {
  if (method === "eth_chainId" || method === "net_version") {
    return CACHE_TTL_MS.forever;
  }

  if (method === "eth_getCode") {
    // Do not cache an empty address forever: a contract may be deployed later.
    return result === "0x" ? CACHE_TTL_MS.short : CACHE_TTL_MS.forever;
  }

  if (method === "eth_getTransactionReceipt") {
    // A null receipt means the transaction may still be pending.
    return result === null ? 0 : CACHE_TTL_MS.long;
  }

  if (method === "eth_getLogs") {
    return isFixedLogsRequest(params) ? CACHE_TTL_MS.long : 0;
  }

  if (
    method === "eth_call" ||
    method === "eth_getBalance" ||
    method === "eth_blockNumber"
  ) {
    return CACHE_TTL_MS.short;
  }

  return 0;
}

function getCachedResult(
  key: string
): { hit: true; result: unknown } | { hit: false } {
  const entry = cache.get(key);

  if (!entry) {
    return { hit: false };
  }

  if (entry.expiresAt !== Infinity && entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false };
  }

  // Refresh insertion order so frequently used entries survive size pruning.
  cache.delete(key);
  cache.set(key, entry);

  return { hit: true, result: entry.result };
}

function setCachedResult(key: string, result: unknown, ttl: number): void {
  if (ttl <= 0) return;

  const now = Date.now();

  for (const [existingKey, entry] of cache) {
    if (entry.expiresAt !== Infinity && entry.expiresAt <= now) {
      cache.delete(existingKey);
    }
  }

  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }

  cache.set(key, {
    result,
    expiresAt: ttl === Infinity ? Infinity : now + ttl,
  });
}

async function callUpstream(
  body: string,
  deadlineAt: number
): Promise<UpstreamResult> {
  let lastFailureStatus: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (remainingTime(deadlineAt) <= 0) {
      return deadlineUpstreamResult();
    }

    const intervalWait = lastCallAt + MIN_INTERVAL_MS - Date.now();

    if (
      intervalWait > 0 &&
      !(await sleepWithinDeadline(intervalWait, deadlineAt))
    ) {
      return deadlineUpstreamResult();
    }

    lastCallAt = Date.now();

    const requestTimeout = Math.min(
      UPSTREAM_TIMEOUT_MS,
      remainingTime(deadlineAt)
    );

    if (requestTimeout <= 0) {
      return deadlineUpstreamResult();
    }

    let response: Response;

    try {
      response = await fetch(ARC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, requestTimeout)),
      });
    } catch (error: unknown) {
      const message = errorMessage(error);

      if (isTimeoutError(error)) {
        console.error("[rpc-proxy] upstream timeout", {
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          timeoutMs: requestTimeout,
          error: message,
        });
      }

      if (remainingTime(deadlineAt) <= 0) {
        return deadlineUpstreamResult();
      }

      if (attempt === MAX_ATTEMPTS - 1) {
        console.error("[rpc-proxy] max attempts exhausted", {
          reason: "upstream request failed",
          attempts: MAX_ATTEMPTS,
          error: message,
        });

        return {
          status: 200,
          text: JSON.stringify(
            rpcError(null, -32005, `upstream request failed: ${message}`)
          ),
        };
      }

      const backoff = 250 * Math.pow(2, attempt);

      if (!(await sleepWithinDeadline(backoff, deadlineAt))) {
        return deadlineUpstreamResult();
      }

      continue;
    }

    if (response.status !== 429 && response.status < 500) {
      return {
        status: response.status,
        text: await response.text(),
      };
    }

    lastFailureStatus = response.status;

    if (attempt < MAX_ATTEMPTS - 1) {
      const backoff = 250 * Math.pow(2, attempt);

      if (!(await sleepWithinDeadline(backoff, deadlineAt))) {
        return deadlineUpstreamResult();
      }
    }
  }

  console.error("[rpc-proxy] max attempts exhausted", {
    reason: "upstream returned retryable status",
    attempts: MAX_ATTEMPTS,
    status: lastFailureStatus,
  });

  // Always answer with HTTP 200 and a JSON-RPC error: ethers treats a non-200 as a
  // network failure and retries, while an error object is reported to the caller.
  return {
    status: 200,
    text: JSON.stringify(
      rpcError(null, -32005, "rate limited upstream")
    ),
  };
}

// Queues the call: at most one request to the node per MIN_INTERVAL_MS.
function enqueue(body: string, deadlineAt: number) {
  const run = chain.then(() => callUpstream(body, deadlineAt));
  chain = run.catch(() => {});
  return run;
}

function methodOf(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const method = (item as Record<string, unknown>).method;
  return typeof method === "string" ? method : "";
}

function idOf(item: unknown): RpcId {
  if (
    item &&
    typeof item === "object" &&
    "id" in (item as Record<string, unknown>)
  ) {
    return (item as Record<string, unknown>).id as RpcId;
  }

  return null;
}

function isNotification(item: unknown): boolean {
  return (
    !item ||
    typeof item !== "object" ||
    !("id" in (item as Record<string, unknown>)) ||
    idOf(item) === undefined
  );
}

async function requestUpstream(
  item: unknown,
  deadlineAt: number
): Promise<RpcObject> {
  const { text } = await enqueue(JSON.stringify(item), deadlineAt);

  if (!text || !text.trim()) {
    return rpcError(null, -32603, "empty response from upstream");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return rpcError(null, -32700, "invalid JSON from upstream");
  }

  // The node may answer a single request with an array — take the first element.
  const object = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!object || typeof object !== "object") {
    return rpcError(null, -32603, "malformed response from upstream");
  }

  return object as RpcObject;
}

// One batch element -> one request to the node. The reply always carries the original id.
async function callSingle(
  item: unknown,
  deadlineAt: number
): Promise<Record<string, unknown> | null> {
  const id = idOf(item);
  const notification = isNotification(item);
  const method = methodOf(item);

  if (!ALLOWED_METHODS.has(method)) {
    console.error("[rpc-proxy] method not allowed", {
      method: method || "(missing)",
    });

    if (notification) return null;

    return rpcError(
      id,
      -32601,
      `method not allowed: ${method || "(missing)"}`
    );
  }

  if (remainingTime(deadlineAt) <= 0) {
    return notification ? null : deadlineError(id);
  }

  try {
    if (notification) {
      await requestUpstream(item, deadlineAt);
      return null;
    }

    const params = paramsOf(item);
    const cacheKey = CACHEABLE_METHODS.has(method)
      ? getCacheKey(method, params)
      : null;

    if (cacheKey) {
      const cached = getCachedResult(cacheKey);

      if (cached.hit) {
        return {
          jsonrpc: "2.0",
          result: cached.result,
          id,
        };
      }
    }

    let upstreamPromise: Promise<RpcObject>;

    if (cacheKey) {
      const existing = inFlight.get(cacheKey);

      if (existing) {
        upstreamPromise = existing;
      } else {
        upstreamPromise = requestUpstream(item, deadlineAt);
        inFlight.set(cacheKey, upstreamPromise);
      }
    } else {
      upstreamPromise = requestUpstream(item, deadlineAt);
    }

    try {
      const object = await upstreamPromise;

      if (cacheKey && "result" in object) {
        const ttl = getCacheTtl(method, params, object.result);
        setCachedResult(cacheKey, object.result, ttl);
      }

      return {
        jsonrpc: "2.0",
        ...object,
        id,
      };
    } finally {
      if (cacheKey && inFlight.get(cacheKey) === upstreamPromise) {
        inFlight.delete(cacheKey);
      }
    }
  } catch (error: unknown) {
    return rpcError(
      id,
      -32603,
      error instanceof Error ? error.message : "proxy error"
    );
  }
}

export async function POST(req: NextRequest) {
  const deadlineAt = Date.now() + POST_DEADLINE_MS;
  const raw = await req.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      rpcError(null, -32600, "request body too large"),
      { status: 413 }
    );
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      rpcError(null, -32700, "parse error"),
      { status: 400 }
    );
  }

  // Batch: split into single calls, then collect the replies back.
  if (Array.isArray(parsedBody)) {
    if (parsedBody.length === 0) {
      return NextResponse.json(
        rpcError(null, -32600, "empty batch"),
        { status: 400 }
      );
    }

    if (parsedBody.length > MAX_BATCH_ITEMS) {
      return NextResponse.json(
        rpcError(
          null,
          -32600,
          `batch too large: ${parsedBody.length} > ${MAX_BATCH_ITEMS}`
        ),
        { status: 400 }
      );
    }

    const results: Array<Record<string, unknown>> = [];

    for (let index = 0; index < parsedBody.length; index++) {
      if (remainingTime(deadlineAt) <= 0) {
        console.error("[rpc-proxy] batch deadline exceeded", {
          completedItems: index,
          totalItems: parsedBody.length,
        });

        for (
          let remainingIndex = index;
          remainingIndex < parsedBody.length;
          remainingIndex++
        ) {
          const remainingItem = parsedBody[remainingIndex];

          if (!isNotification(remainingItem)) {
            results.push(deadlineError(idOf(remainingItem)));
          }
        }

        break;
      }

      const result = await callSingle(parsedBody[index], deadlineAt);

      if (result) {
        results.push(result);
      }
    }

    // A batch of notifications only — per the spec no body, 204.
    if (results.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    return new NextResponse(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const single = await callSingle(parsedBody, deadlineAt);

  if (!single) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(JSON.stringify(single), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
