# FORT

Multisig dApp for secure USDC transfers on Arc Testnet. Built with Next.js (App Router) + ethers.

https://fortsafe.vercel.app/

## Features
- Wallet connect: EIP-6963 + fallback (`WalletConnectModal`), normalized EIP-1193 (`provider.request`)
- Auto add/switch to Arc Testnet
- Safe flow: 3 owners, threshold 2
- Create / confirm / execute transfers
- Access control: only Safe owners can view owners, balances, and transactions (otherwise: Access denied)
- Sync: scans `SaveCreated` via chunked `provider.getLogs` and stores the last scanned block per wallet

## Network
- ChainId: `5042002` (`0x4cef52`)
- RPC: https://rpc.testnet.arc.network
- Explorer: https://testnet.arcscan.app
  - tx: `/tx/<hash>`
  - address: `/address/<addr>`

## Contracts
- Factory: `0xd09B0e8c53354Bf0865940371FD6ff98874D1b89`
- Event: `SaveCreated`

## Data persistence
The dApp stores Safe metadata, tx hashes, and Sync scan progress in browser `localStorage` (per wallet).

## Run locally
```bash
npm i
npm run dev
