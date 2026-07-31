# FORT

Multisig dApp for secure transfers on Arc Testnet. Built with Next.js (App Router) + ethers.

https://fortsafe.vercel.app/

## Features
- Wallet connect: picks an injected EIP-1193 provider (`window.ethereum`, or one entry of
  `window.ethereum.providers`, identified by `isMetaMask` / `isRabby` / `isCoinbaseWallet`),
  chosen by the user in `WalletConnectModal` and remembered in `localStorage` for silent
  reconnect. Every wallet call goes through one wrapper with a timeout, so a wallet that
  never answers cannot hang the UI
- Auto add/switch to Arc Testnet
- Safe flow: 3 owners, threshold 2 of 3
- Create / confirm / revoke / execute transfers
- Cancel a pending transfer: also 2 of 3, a single vote only records intent and can be revoked. One exception: the proposer can cancel their own transfer alone, as long as no other owner has confirmed it
- On-chain Safe names, stored in the factory
- Sync: reads the caller's Safes from the factory page by page (`safesCountForOwner` +
  `getSafesForOwnerPaged`), so the list never arrives in one unbounded `eth_call`
- Reads made in the browser go through the app's own RPC proxy (`/api/rpc`); the wallet is
  used only for signing and network detection

## What "access control" means here
This is a UI-level restriction, not a privacy guarantee.

The UI shows owners, balances and transactions only to an address that is one of the
Safe's 3 owners; anyone else gets "Access denied". The contract, however, exposes all of
that data through public view functions, and the chain itself is public: any observer can
read the same state directly from a node or a block explorer.

What is actually enforced on-chain is authorization to act, not to look:
- only an owner can create, confirm, revoke, cancel or execute a transfer;
- a transfer executes only with 2 of 3 confirmations;
- a transfer is canceled only with 2 of 3 cancel votes, with one exception: the proposer may cancel their own transfer alone while no other owner has confirmed it.

Treat the Safe's contents as public information.

## Balances
The contract reserves the amount of every created transfer in `pendingAmount`, so two
numbers are not the same:
- **balance** - everything the Safe holds;
- **available balance** - what is left after the reservations of pending transfers.

Creating a transfer is checked against the available balance, executing one against the
full balance: the reservation is released as the transfer executes.

A reservation can get stuck. If the recipient of a created transfer reverts on receive,
`executeTx` keeps failing and the amount stays in `pendingAmount`, lowering
`availableBalance()` for everyone. Cancelling releases it, but once the transfer has
reached the confirmation threshold `cancelTx` reverts with `QuorumReached()`. The way out
is `revokeConfirm`: any owner who confirmed revokes their confirmation, the count drops
below the threshold, and the transfer can then be cancelled, which frees the reserve.

## RPC proxy
`app/api/rpc/route.ts` is not a transparent pass-through. Browser reads are sent to it and
it decides what reaches the upstream node.

What it enforces on the way in:
- **method allowlist** - 14 read-only JSON-RPC methods; anything else is rejected with
  `-32601`, so the proxy cannot be used as a generic relay;
- **origin check** - `Origin` (or `Referer` as a fallback) is mandatory and must match a
  known host; a request carrying neither header is refused with `403`, so the proxy is not
  a free gateway to the node for anyone with `curl`;
- **rate limit** - a token bucket per client, 60 requests per 10 s window, keyed on
  `x-vercel-forwarded-for`, which the Vercel edge sets and a client cannot spoof;
- **size limits** - request bodies over 128 KB are rejected with `413` (checked against the
  declared `content-length` first, then against the real byte length of the body, not its
  character count), and batches are capped at 20 items;
- **envelope validation** - a request `id` must be a string, a number or `null`; anything
  else gets `-32600` instead of being forwarded;
- **`eth_getLogs` span** - a block range wider than 100 blocks is refused with `-32602`
  rather than passed on to the node.

What it does on the way out:
- **caching** with a per-method TTL for the responses that tolerate it: immutable answers
  (`eth_chainId`, a mined receipt's block, deployed code) are kept indefinitely, `eth_getLogs`
  over a closed block range for 5 min, and volatile reads for 3 s; a pending receipt and an
  open-ended log range are not cached at all;
- **in-flight coalescing** - identical concurrent requests share a single upstream call;
- **a serialized queue** with a 120 ms minimum interval between upstream calls, plus
  retries;
- **deadlines** - 10 s per upstream call, 25 s for the whole request.

`GET /api/rpc` returns a small health object: upstream host, allowlist size, the current
limits and the name of the cache-bypass request header (`x-fort-fresh`), which a read sends
when it must not be served from the cache.

### Known limitations

Both of these are deliberate choices for a testnet deployment, not oversights. They are
listed here so that nobody reads more strength into the proxy than it has.

**The origin check is not authentication.** It only requires the header to be present and
to name a known host, and a client sets that header freely. A request forged with
`curl -H "Origin: https://fortsafe.vercel.app"` still passes. What the check removes is the
casual free ride, not a determined caller. Real authentication would mean a shared secret
or a signed request issued by the page, which is deliberately out of scope while this runs
on a testnet with no cost attached to the upstream node.

**The rate limiter and the cache are per instance, best-effort.** `rateBuckets`, `cache`,
`lastCallAt` and the serialized queue are plain in-memory state. Serverless platforms run
as many instances as traffic demands and each gets its own copy, so "60 requests per 10 s"
is enforced per instance rather than globally, and a cache hit depends on which instance
served the request. The limiter is therefore a guard against accidental hammering - a
runtime loop in the UI, a stuck retry - and not a defense against a distributed one.

Both are worth revisiting under one condition: the app moving to mainnet or the public
domain taking real traffic. The replacement for the second one is a shared store for the
counters and the cache, such as Vercel KV or Upstash Redis; until then the added
dependency buys nothing.

## Network
- Name: Arc Testnet
- ChainId: `5042002`
- RPC: https://rpc.testnet.arc.network
- Currency symbol: USDC (also the gas token)
- Explorer: https://testnet.arcscan.app
- Faucet: https://faucet.circle.com

## Contracts
- Factory: the address is not repeated here on purpose. The single copy kept in this
  repository is `NEXT_PUBLIC_FACTORY_ADDRESS` in `.env.example` (see Environment
  variables), and that is also the value the app reads at build time. On a redeploy, update
  the environment variable in Vercel and the value in `.env.example` - nothing else.
- Events: `SaveCreated`, `SafeRenamed`, `Deposit`, `TxCreated`, `TxConfirmed`, `TxRevoked`, `TxCancelVoted`, `TxCancelVoteRevoked`, `TxCanceled`, `TxExecuted`
- Sources and tests: `fort-contracts` (Foundry)

## Project layout
```
app/
  api/rpc/route.ts        RPC proxy: all browser reads go through it
  safe/
    page.tsx              page state, safe loading, layout
    components/           CreateSafeModal, TransferModal, RenameSafeModal,
                          RemoveSafeModal, TxCard, SafeRow, ui
    hooks/                useWallet (connection, network, events),
                          useTxActions (every on-chain write)
    lib/                  chain (addresses, ABIs, read provider),
                          safeData (snapshot reads), storage (localStorage),
                          errors (contract error decoding), txHashes, format
components/               WalletMenu, WalletConnectModal
```

Note on the read provider: `chain.ts` points at `/api/rpc` only when it runs in the
browser. In server-side code there is no relative URL to resolve, so it falls back to the
public node directly and the proxy is bypassed.

## Data persistence
The dApp stores Safe metadata, a snapshot of each Safe and transaction hashes in browser
`localStorage`, per wallet. The snapshot lets a background refresh re-read a bounded window
of the most recent transactions plus any older ones that are still open, instead of the
whole list. Clearing site data loses nothing that matters: the Safes themselves are
recovered from the factory by Sync.

## Environment variables
See `.env.example`. Locally they live in `.env`; on Vercel, in the project's environment
variables. `NEXT_PUBLIC_*` values are inlined at build time, so changing one requires a
rebuild, not just a restart.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | yes | none | Address of the SaveFactory the app reads Safes from. |
| `NEXT_PUBLIC_ARC_EXPLORER_TX` | no | `https://testnet.arcscan.app/tx/` | Explorer transaction URL prefix used to build tx links. |

`NEXT_PUBLIC_FACTORY_ADDRESS` has no fallback on purpose: a wrong or missing factory would
otherwise surface much later as an empty Safe list. `chain.ts` throws on import if the
variable is unset, and validates the EIP-55 checksum with `getAddress`, so a typo fails the
build with a named error instead of a silent misread.

## Run locally
```bash
npm i
npm run dev
```

`npm run dev` does not type-check. Before committing, run the production build, which does:

```bash
npm run build
```