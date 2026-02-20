# Backend API

Backend per ComputeBasin con due namespace API distinti:

- `legacy marketplace` (`/api/...`): usato dalla landing attuale (Home/Admin)
- `RBAC phase-1` (`/api/rbac/...` + `/api/properties|hardware-specs|tokens`): modello esteso per proprietà/token/pool/compute

## Endpoints principali (legacy)

- `GET /api/health`
- `GET /api/meta`
- `GET /api/auth/roles`
- `GET /api/sites`
- `POST /api/admin/sites`
- `GET /api/pools`
- `GET /api/pools/:poolId`
- `POST /api/admin/pools`
- `POST /api/pools/:poolId/contribute`
- `POST /api/pools/:poolId/refund`
- `POST /api/admin/pools/:poolId/acquisition-doc`
- `POST /api/admin/pools/:poolId/documents/finalize`
- `POST /api/admin/pools/:poolId/compute-offer`
- `GET /api/compute/offers`
- `POST /api/compute/rent`
- `GET /api/wallets/:walletAddress/summary`
- `GET /api/proofs/:proofId`
- `POST /api/proofs/:proofId/verify-hash`

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
- `IOTA_NOTARIZATION_PROVIDER=passport|official_locked`:
  - `passport` (default): usa `contracts/sources/passport.move` e mantiene il legame con `SiteNFT`
  - `official_locked`: usa libreria ufficiale `@iota/notarization` (locked notarization object) con stato JSON batch
- In live mode, signer backend per notarization deve coincidere con `ADMIN_WALLET` (enforced lato API admin)

## Modalità contributi pool (legacy)

- `REQUIRE_ONCHAIN_CONTRIBUTION=false` (default): modalità demo, nessun pagamento on-chain richiesto.
- `REQUIRE_ONCHAIN_CONTRIBUTION=true`: `POST /api/pools/:poolId/contribute` richiede `paymentTxDigest`.
- Il contributore non puo' coincidere con `CONTRIBUTION_RECIPIENT_WALLET` (treasury): deve essere un wallet separato.
- Il backend verifica su RPC IOTA:
  - tx eseguita con successo
  - sender = wallet contributor
  - accredito `Coin<IOTA>` verso `CONTRIBUTION_RECIPIENT_WALLET` (o `ADMIN_WALLET`) >= `tokenAmount * CONTRIBUTION_PRICE_NANOS`
- I token contributo vengono prima bloccati su ledger interno (`walletLockedBalances`) e diventano spendibili solo quando il pool arriva a `funded`.
- Se la deadline funding scade e il pool non raggiunge l'hard cap, lo stato diventa `failed` e i contributor possono usare `POST /api/pools/:poolId/refund`.
- In on-chain mode il rimborso invia una tx IOTA dal backend signer (`IOTA_SIGNER_SECRET_KEY`): il signer deve avere fondi sufficienti.

## Registrazione siti (legacy admin)

- `POST /api/admin/sites` permette di creare nuovi siti prima della creazione pool.
- Se non passi `iotaSiteObjectId`, il backend tenta mint `SiteNFT` via `passport::mint_site_nft`:
  - `MOCK_IOTA=true` -> object/digest mock (non visibile in explorer)
  - `MOCK_IOTA=false` -> tx reale su IOTA L1

## Capacity lifecycle rental (legacy)

- `POST /api/compute/rent` crea rental con `startAtMs` e `endAtMs`.
- Alla scadenza, la capacità viene rilasciata automaticamente su `GET /api/compute/offers` e `GET /api/wallets/:walletAddress/summary`.

## Notarizzazione documenti (legacy)

- Creazione pool (`POST /api/admin/pools`): tutti i documenti iniziali vengono notarizzati in **batch** su una singola tx.
- Upload batch extra (`POST /api/admin/pools/:poolId/documents/finalize`): permette di finalizzare upload successivi in **batch** su una singola tx.
- Upload documenti compute offer (`POST /api/admin/pools/:poolId/compute-offer`): i documenti del payload vengono notarizzati in **batch** su una singola tx.
- Acquisition deed (`POST /api/admin/pools/:poolId/acquisition-doc`): 1 documento => 1 tx.
- Ogni proof salva `iotaTxDigest`, `iotaSignedBy`, `notarizationProvider`, `docHashSha256` per audit/explorer verification.
- In mock mode i digest sono sintetici (`chainMode=mock`) e non compaiono in explorer.

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
