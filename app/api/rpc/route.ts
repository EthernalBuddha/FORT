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

// Per-client rate limit. Coarse on purpose: the counter lives in this instance's
// memory, like the 120 ms queue above, so it stops a single misbehaving script
// but not a distributed load.
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_CLIENTS = 1000;

// Browser traffic has to come from our own site. Any header below can be forged
// by a hand-written client, so this only stops a third-party page from routing
// its users through our domain. It is not authentication.
const ALLOWED_ORIGIN_HOSTS = new Set([
  "fortsafe.vercel.app",
  "localhost",
  "127.0.0.1",
]);

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

type SourceCheck = { allowed: boolean; reason: string };

// Origin is mandatory. A browser always sends it on a cross-origin POST with a
// JSON body, so requiring it costs real users nothing while closing the open
// relay: curl and scripted clients send no Origin and are now rejected.
//
// This is still not authentication - a hand-written client can forge the header.
// It removes the free pass, not the possibility of a deliberate attack.
//
// Note: this route no longer answers server side callers (route handlers, cron,
// scripts). Nothing in save-ui calls it that way today. If that changes, add a
// shared-secret header check here rather than loosening the Origin rule.
function checkSource(req: NextRequest): SourceCheck {
  const candidate = req.headers.get("origin") || req.headers.get("referer");

  if (!candidate) return { allowed: false, reason: "missing origin header" };

  let host = "";

  try {
    host = new URL(candidate).hostname;
  } catch {
    return { allowed: false, reason: "unparsable origin " + candidate };
  }

  if (ALLOWED_ORIGIN_HOSTS.has(host)) return { allowed: true, reason: host };

  const vercelHost = process.env.VERCEL_URL;

  if (vercelHost && host === vercelHost) return { allowed: true, reason: host };

  return { allowed: false, reason: "host not allowed " + host };
}

type RateBucket = { tokens: number; updatedAt: number };

const rateBuckets = new Map<string, RateBucket>();

// x-vercel-forwarded-for is written by the platform edge and overwrites whatever
// the client sent, so it cannot be spoofed. x-forwarded-for can: the edge only
// appends to it, and a client-supplied left-most entry survives. Prefer the
// trusted header and keep the others as a local-development fallback, where
// there is no edge and no untrusted traffic either.
function getClientKey(req: NextRequest): string {
  const vercelForwarded = req.headers.get("x-vercel-forwarded-for");

  if (vercelForwarded) {
    const first = vercelForwarded.split(",")[0];
    if (first && first.trim()) return first.trim();
  }

  // Local development only: on Vercel the header above is always present.
  if (!process.env.VERCEL) {
    const forwarded = req.headers.get("x-forwarded-for");

    if (forwarded) {
      const first = forwarded.split(",")[0];
      if (first && first.trim()) return first.trim();
    }

    const realIp = req.headers.get("x-real-ip");
    if (realIp && realIp.trim()) return realIp.trim();
  }

  return "unknown";
}

function takeToken(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const refillPerMs = RATE_LIMIT_MAX_REQUESTS / RATE_LIMIT_WINDOW_MS;

  if (rateBuckets.size > RATE_LIMIT_MAX_CLIENTS) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.updatedAt > RATE_LIMIT_WINDOW_MS) {
        rateBuckets.delete(bucketKey);
      }
    }

    if (rateBuckets.size > RATE_LIMIT_MAX_CLIENTS) rateBuckets.clear();
  }

  const existing = rateBuckets.get(key);
  const tokens = existing
    ? Math.min(
        RATE_LIMIT_MAX_REQUESTS,
        existing.tokens + (now - existing.updatedAt) * refillPerMs
      )
    : RATE_LIMIT_MAX_REQUESTS;

  if (tokens < 1) {
    rateBuckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / refillPerMs) };
  }

  rateBuckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, retryAfterMs: 0 };
}

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

const MAX_LOG_BLOCK_SPAN = 100;

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

// eth_getLogs: refuse windows wider than MAX_LOG_BLOCK_SPAN blocks.
// Returns an error message, or null when the request is acceptable.
function logsRangeError(params: unknown): string | null {
  if (!Array.isArray(params) || !params[0] || typeof params[0] !== "object") {
    return null;
  }

  const filter = params[0] as Record<string, unknown>;

  // A single block addressed by hash is always one block wide.
  if (typeof filter.blockHash === "string") {
    return null;
  }

  // Per the JSON-RPC spec both bounds default to "latest" when omitted.
  const from = filter.fromBlock === undefined ? "latest" : filter.fromBlock;
  const to = filter.toBlock === undefined ? "latest" : filter.toBlock;

  if (isFixedBlockTag(from) && isFixedBlockTag(to)) {
    const span = BigInt(to as string) - BigInt(from as string) + BigInt(1);

    if (span > BigInt(MAX_LOG_BLOCK_SPAN)) {
      return (
        "eth_getLogs range too wide: " +
        span.toString() +
        " blocks, max " +
        MAX_LOG_BLOCK_SPAN
      );
    }

    return null;
  }

  // Identical symbolic tags ("latest" to "latest") also describe one block.
  if (typeof from === "string" && from === to) {
    return null;
  }

  // Anything else is open ended: "earliest" to "latest", or a hex bound paired
  // with a moving tag. The width cannot be checked without asking the node.
  return (
    "eth_getLogs requires a fixed block range of at most " +
    MAX_LOG_BLOCK_SPAN +
    " blocks"
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

// JSON-RPC 2.0: a notification is a request with no "id" member at all.
// A present-but-null id is a normal request and must be answered.
//
// The old "idOf(item) === undefined" clause was dead code: idOf returns null,
// never undefined, so it never fired and only looked like a guard.
function isNotification(item: unknown): boolean {
  return (
    !item ||
    typeof item !== "object" ||
    !("id" in (item as Record<string, unknown>))
  );
}

// The spec allows a string, a number or null as an id. Anything else cannot be
// echoed back in a form the client can match against its own call, so it is
// rejected instead of being quietly answered with id: null.
function hasValidId(item: unknown): boolean {
  if (isNotification(item)) return true;

  const id = (item as Record<string, unknown>).id;

  return id === null || typeof id === "string" || typeof id === "number";
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

  if (!hasValidId(item)) {
    console.error("[rpc-proxy] invalid request id");

    return rpcError(null, -32600, "invalid request id");
  }

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

  if (method === "eth_getLogs") {
    const rangeError = logsRangeError(paramsOf(item));

    if (rangeError) {
      console.error("[rpc-proxy] logs range rejected", { message: rangeError });

      if (notification) return null;

      return rpcError(id, -32602, rangeError);
    }
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

// Liveness probe for this route. It never touches the node, so a monitor
// hitting it costs nothing and it says nothing about upstream health. The
// numbers below are limits already visible from the outside by probing.
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      upstream: new URL(ARC_RPC_URL).host,
      methods: ALLOWED_METHODS.size,
      maxBodyBytes: MAX_BODY_BYTES,
      maxBatchItems: MAX_BATCH_ITEMS,
    },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const deadlineAt = Date.now() + POST_DEADLINE_MS;

  // Source first, rate limit second. A rejected request must not allocate a
  // bucket: rateBuckets is an in-memory map, and letting anonymous traffic
  // create entries in it turns the limiter itself into a memory target.
  const source = checkSource(req);

  if (!source.allowed) {
    console.error("[rpc-proxy] blocked source: " + source.reason);
    return NextResponse.json(rpcError(null, -32600, "origin not allowed"), {
      status: 403,
    });
  }

  const rate = takeToken(getClientKey(req));

  if (!rate.allowed) {
    console.error("[rpc-proxy] rate limit hit");
    return NextResponse.json(rpcError(null, -32005, "too many requests"), {
      status: 429,
      headers: { "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) },
    });
  }

  // content-length may be absent or a lie, so it is only a cheap early exit
  // that avoids buffering an oversized body. The real check is below.
  const declaredBytes = Number(req.headers.get("content-length"));

  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    console.error("[rpc-proxy] body too large", {
      bytes: declaredBytes,
      declared: true,
    });

    return NextResponse.json(
      rpcError(null, -32600, "request body too large"),
      { status: 413 }
    );
  }

  const raw = await req.text();

  // raw.length counts UTF-16 code units, not bytes. Non-ASCII text weighs up
  // to three bytes per unit, so the old check let through several times the
  // limit this constant promises.
  const bodyBytes = Buffer.byteLength(raw, "utf8");

  if (bodyBytes > MAX_BODY_BYTES) {
    console.error("[rpc-proxy] body too large", { bytes: bodyBytes });

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
