# Backend API

Backend per ComputeBasin con due namespace API distinti:

- `legacy marketplace` (`/api/...`): usato dalla landing attuale (Home/Admin)
- `RBAC phase-1` (`/api/rbac/...` + `/api/properties|hardware-specs|tokens`): modello esteso per proprietà/token/pool/compute

## Endpoints principali (legacy)

- `GET /api/health`
- `GET /api/meta`
- `GET /api/auth/roles`
- `GET /api/sites`
- `GET /api/pools`
- `GET /api/pools/:poolId`
- `POST /api/admin/pools`
- `POST /api/pools/:poolId/contribute`
- `POST /api/admin/pools/:poolId/acquisition-doc`
- `POST /api/admin/pools/:poolId/compute-offer`
- `GET /api/compute/offers`
- `POST /api/compute/rent`
- `GET /api/wallets/:walletAddress/summary`
- `GET /api/proofs/:proofId`

## Endpoints principali (RBAC phase-1)

- `GET|POST /api/properties`
- `GET|PUT|DELETE /api/properties/:propertyId`
- `GET|POST /api/hardware-specs`
- `GET|PUT|DELETE /api/hardware-specs/:hardwareId`
- `GET|POST /api/tokens`
- `GET|PUT /api/tokens/:tokenId`
- `POST /api/tokens/:tokenId/allocate`
- `GET /api/tokens/:tokenId/allocations`
- `GET /api/tokens/wallet/:walletAddress/holdings`
- `GET|POST /api/rbac/pools`
- `GET|PUT /api/rbac/pools/:poolId`
- `POST /api/rbac/pools/:poolId/transition-phase`
- `GET /api/rbac/pools/:poolId/stats`
- `GET|POST /api/rbac/compute`
- `GET|PUT /api/rbac/compute/:offerId`
- `POST /api/rbac/compute/:offerId/rent`
- `GET /api/rbac/compute/:offerId/rentals`
- `GET /api/rbac/compute/stats/marketplace`

## Sicurezza admin

Le route `/api/admin/*` richiedono wallet address uguale a `ADMIN_WALLET`.
Puoi passarlo in header `x-wallet-address` o body `walletAddress`.

## Modalità IOTA

- `MOCK_IOTA=true`: notarization mock
- `MOCK_IOTA=false`: notarization reale IOTA testnet con signer backend

## Test automatici

Suite integrazione/API contract:

```bash
npm test
```

Copertura attuale:
- health/meta/auth contract
- enforcement RBAC admin/non-admin
- flusso RBAC `property -> token -> pool`
- flusso legacy completo `fundraising -> acquisition -> compute -> rent`
