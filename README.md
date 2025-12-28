# FORT

Multisig dApp for secure USDC transfers on **Arc Testnet**. Built with **Next.js (App Router)** + **ethers**.


https://fortsafe.vercel.app/

## Features
- Wallet connect: EIP-6963 + fallback (`WalletConnectModal`), normalized EIP-1193 (`provider.request`)
- Auto add/switch to Arc Testnet
- Safe flow: 3 owners, threshold 2
- Owners / balance / txs only if connected wallet is an owner (otherwise: Access denied)
- Create / confirm / execute transfers
- Sync owned Safes by scanning `SaveCreated` logs via chunked `provider.getLogs`, persists last scanned block

## Network
- ChainId: `5042002` (`0x4cef52`)
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
  - tx: `/tx/<hash>`
  - address: `/address/<addr>`

## Contracts
- Factory: `0xd09B0e8c53354Bf0865940371FD6ff98874D1b89`
- Event: `SaveCreated`

## localStorage
- `arcsafe:safeName:<addr>`
- `arcsafe:safesByWallet:<wallet>` (robust parse + migration)
- `arcsafe:txHash:<safe>:<id>`
- `arcsafe:scanBlock:<wallet>`

## Run locally
```bash
npm i
npm run dev
