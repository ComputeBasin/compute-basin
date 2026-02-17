# Backend API

Backend per:
- pagina admin wallet-gated
- creazione pool terreni con documenti notarizzati
- contributi token alla pool con tracking avanzamento
- attivazione noleggio potenza computazionale
- noleggio compute usando i token accumulati nella pool

## Endpoints principali

- `GET /api/health`
- `GET /api/meta`
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

## Sicurezza admin

Le route `/api/admin/*` richiedono wallet address uguale a `ADMIN_WALLET`.
Puoi passarlo in header `x-wallet-address` o body `walletAddress`.

## Modalità IOTA

- `MOCK_IOTA=true`: notarization mock
- `MOCK_IOTA=false`: notarization reale IOTA testnet con signer backend
