# FORT / ArcSafe (ARCsafe2)

A minimal multisig dApp for secure USDC transfers on **Arc Testnet**.  
Built with **Next.js (App Router)** + **ethers**. Focus: clean UX, reliable wallet onboarding, and a simple 3-owner / 2-threshold flow.

## Demo
- https://arc-safe.vercel.app (opens the dApp at `/safe`)

## What it does
- Connects injected wallets (EIP-6963 + fallback) via a custom `WalletConnectModal`
- Auto-adds / switches to Arc Testnet
- Creates and loads a Safe (multisig) on-chain
- Shows owners, balance, and transactions **only if your wallet is an owner** (otherwise: Access denied)
- Creates / confirms / executes transfers
- Stores tx hashes and Safe metadata in localStorage
- Syncs owned safes by scanning `SaveCreated` logs (chunked `getLogs`) and remembers last scanned block

## Network
- Chain: Arc Testnet
- ChainId: `5042002` (`0x4cef52`)
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`  
  - tx: `/tx/<hash>`
  - address: `/address/<addr>`

## Contracts
- Factory: `0xd09B0e8c53354Bf0865940371FD6ff98874D1b89`
- Event: `SaveCreated`

## Storage keys
- `arcsafe:safeName:<addr>`
- `arcsafe:safesByWallet:<wallet>` (robust parse + migration)
- `arcsafe:txHash:<safe>:<id>`
- `arcsafe:scanBlock:<wallet>`

## Run locally
```bash
npm i
npm run dev
