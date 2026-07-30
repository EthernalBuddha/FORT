# FORT

Multisig dApp for secure transfers on Arc Testnet. Built with Next.js (App Router) + ethers.

https://fortsafe.vercel.app/

## Features
- Wallet connect: EIP-6963 + fallback (`WalletConnectModal`), normalized EIP-1193 (`provider.request`)
- Auto add/switch to Arc Testnet
- Safe flow: 3 owners, threshold 2 of 3
- Create / confirm / revoke / execute transfers
- Cancel a pending transfer: also 2 of 3, a single vote only records intent and can be revoked
- On-chain Safe names, stored in the factory
- Sync: reads the caller's Safes from the factory via `getSafesForOwner`
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
- a transfer is canceled only with 2 of 3 cancel votes.

Treat the Safe's contents as public information.

## Balances
The contract reserves the amount of every created transfer in `pendingAmount`, so two
numbers are not the same:
- **balance** — everything the Safe holds;
- **available balance** — what is left after the reservations of pending transfers.

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
- **origin check** - `Origin` / `Referer` must match a known host, otherwise `403`;
- **rate limit** - a token bucket per client IP, 60 requests per 10 s window;
- **size limits** - request bodies over 128 KB are rejected with `413` (checked against the
  declared `content-length` first, then against the real byte length of the body, not its
  character count), and batches are capped at 20 items;
- **envelope validation** - a request `id` must be a string, a number or `null`; anything
  else gets `-32600` instead of being forwarded;
- **`eth_getLogs` span** - a block range wider than 100 blocks is refused with `-32602`
  rather than passed on to the node.

What it does on the way out:
- **caching** with a short TTL for the responses that tolerate it;
- **in-flight coalescing** - identical concurrent requests share a single upstream call;
- **a serialized queue** with a 120 ms minimum interval between upstream calls, plus
  retries;
- **deadlines** - 10 s per upstream call, 25 s for the whole request.

`GET /api/rpc` returns a small health object: upstream host, allowlist size and the current
limits.

One honest limitation: the rate limiter and the cache live in the memory of a single
instance. On serverless deployments the counters are diluted across instances, so the limit
is a guard against accidental hammering, not against a distributed one. A shared store
would be required for that.

## Network
- Name: Arc Testnet
- ChainId: `5042002`
- RPC: https://rpc.testnet.arc.network
- Currency symbol: USDC (also the gas token)
- Explorer: https://testnet.arcscan.app
- Faucet: https://faucet.circle.com

## Contracts
- Factory: `0xc965e062f93F35507DF0F9E9a3973F04704215dA` (deployed at block 54284174)
- Events: `SaveCreated`, `TxCreated`, `TxConfirmed`, `TxExecuted`, `TxCanceled`, `TxCancelVoted`
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
`localStorage`, per wallet. The snapshot lets a background refresh re-read the last 20
transactions plus any older ones that are still open, instead of the whole list. Clearing
site data loses nothing that matters: the Safes themselves are recovered from the factory
by Sync.

## Environment variables
Optional, with a sensible default. See `.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_ARC_EXPLORER_TX` | `https://testnet.arcscan.app/tx/` | Explorer transaction URL prefix used to build tx links. |

## Run locally
```bash
npm i
npm run dev
```

`npm run dev` does not type-check. Before committing, run the production build, which does:

```bash
npm run build
```
