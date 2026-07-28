import { NextRequest, NextResponse } from "next/server";

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const MIN_INTERVAL_MS = 120;
const MAX_ATTEMPTS = 5;

// Hard limits. Without them this route is an open relay: anybody can point their
// wallet at our domain and spend the node's rate limit, and a single oversized
// batch can hold the function until the platform timeout kills it.
const MAX_BODY_BYTES = 128 * 1024;
const MAX_BATCH_ITEMS = 20;
const UPSTREAM_TIMEOUT_MS = 10_000;

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

let lastCallAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RpcId = string | number | null;

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callUpstream(body: string) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    let res: Response;
    try {
      res = await fetch(ARC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        // A hung node must not hold the serverless function for its whole lifetime.
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e: unknown) {
      if (attempt === MAX_ATTEMPTS - 1) {
        return {
          status: 200,
          text: JSON.stringify(
            rpcError(null, -32603, e instanceof Error ? e.message : "upstream request failed")
          ),
        };
      }
      await sleep(250 * Math.pow(2, attempt));
      continue;
    }

    if (res.status !== 429 && res.status < 500) {
      return { status: res.status, text: await res.text() };
    }
    await sleep(250 * Math.pow(2, attempt));
  }

  // Always answer with HTTP 200 and a JSON-RPC error: ethers treats a non-200 as a
  // network failure and retries, while an error object is reported to the caller.
  return {
    status: 200,
    text: JSON.stringify(rpcError(null, -32005, "rate limited upstream")),
  };
}

// Queues the call: at most one request to the node per MIN_INTERVAL_MS.
function enqueue(body: string) {
  const run = chain.then(() => callUpstream(body));
  chain = run.catch(() => {});
  return run;
}

function methodOf(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const m = (item as Record<string, unknown>).method;
  return typeof m === "string" ? m : "";
}

function idOf(item: unknown): RpcId {
  if (item && typeof item === "object" && "id" in (item as Record<string, unknown>)) {
    return (item as Record<string, unknown>).id as RpcId;
  }
  return null;
}

// One batch element -> one request to the node. The reply always carries the original id.
async function callSingle(item: unknown): Promise<Record<string, unknown> | null> {
  const id = idOf(item);

  // Notification (no id) — per the spec there must be no reply.
  const isNotification =
    !item ||
    typeof item !== "object" ||
    !("id" in (item as Record<string, unknown>)) ||
    id === undefined;

  const method = methodOf(item);
  if (!ALLOWED_METHODS.has(method)) {
    if (isNotification) return null;
    return rpcError(id, -32601, `method not allowed: ${method || "(missing)"}`);
  }

  try {
    const { text } = await enqueue(JSON.stringify(item));

    if (isNotification) return null;

    if (!text || !text.trim()) {
      return rpcError(id, -32603, "empty response from upstream");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return rpcError(id, -32700, "invalid JSON from upstream");
    }

    // The node may answer a single request with an array — take the first element.
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;

    if (!obj || typeof obj !== "object") {
      return rpcError(id, -32603, "malformed response from upstream");
    }

    return { jsonrpc: "2.0", ...(obj as Record<string, unknown>), id };
  } catch (e: unknown) {
    if (isNotification) return null;
    return rpcError(id, -32603, e instanceof Error ? e.message : "proxy error");
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(rpcError(null, -32600, "request body too large"), { status: 413 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "parse error"), { status: 400 });
  }

  // Batch: split into single calls, then collect the replies back.
  if (Array.isArray(parsedBody)) {
    if (parsedBody.length === 0) {
      return NextResponse.json(rpcError(null, -32600, "empty batch"), { status: 400 });
    }

    if (parsedBody.length > MAX_BATCH_ITEMS) {
      return NextResponse.json(
        rpcError(null, -32600, `batch too large: ${parsedBody.length} > ${MAX_BATCH_ITEMS}`),
        { status: 400 }
      );
    }

    const results: Array<Record<string, unknown>> = [];
    for (const item of parsedBody) {
      const r = await callSingle(item);
      if (r) results.push(r);
    }

    // A batch of notifications only — per the spec no body, 204.
    if (results.length === 0) return new NextResponse(null, { status: 204 });

    return new NextResponse(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Single request. It goes through the same allowlist and the same error shape as a
  // batch element, so ethers sees one consistent behaviour in both cases.
  const single = await callSingle(parsedBody);
  if (!single) return new NextResponse(null, { status: 204 });

  return new NextResponse(JSON.stringify(single), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
