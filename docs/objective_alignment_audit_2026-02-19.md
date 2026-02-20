# ComputeBasin Objective Alignment Audit

Date: 2026-02-20 (updated)

## Scope reviewed

- Objectives from `riassunto_progetto.md` and main workflow intent.
- Current backend (`legacy` + `RBAC` routes), frontend flows, Move contract module.
- Real execution behavior vs expected business process.

## 1) What works today (implemented and tested)

1. Pool fundraising flow with hard cap and deadline.
2. On-chain contribution verification mode (tx digest required when enabled).
3. Locked token settlement until pool reaches funded state.
4. Failed-pool refund workflow for contributors.
5. Admin acquisition-doc notarization route with proof retrieval.
6. Compute offers and rental booking with capacity checks.
7. Auto-release of rented units at rental expiry (`endAtMs`).
8. Admin site registration flow (`POST /api/admin/sites`) with optional SiteNFT mint.
9. Batch notarization in one tx for pool-creation docs and compute-offer docs.
10. Proof hash verification endpoint (`POST /api/proofs/:proofId/verify-hash`) and UI check flow.
11. On-chain escrow path (enabled + enforced when `REQUIRE_ONCHAIN_CONTRIBUTION=true`):
- New Move module `pool_escrow.move` with `create_pool`, `contribute`, `withdraw_to_treasury`, `refund`.
- Backend can create escrow object at pool creation and verify contribution/refund tx via on-chain events.
12. Admin runtime network switch:
- `POST /api/admin/iota/network` updates active backend network (`localnet`/`testnet`/`mainnet`) and dashboard labels.
- Meta now exposes `iotaActiveNetwork`, `iotaAvailableNetworks`, and per-network profile status.

## 2) What is partially implemented

1. Notarization visibility:
- Proofs are stored and retrievable from `/api/proofs/:proofId`.
- Explorer visibility depends on `chainMode`.
- If `MOCK_IOTA=true`, digests are synthetic and do not appear in explorer.

2. Compute documentation traceability:
- Compute offer docs are now notarized in legacy admin flow and attached as proofs.
- However there is no explicit legal schema enforcement (e.g. mandatory maintenance checklist format).

3. Escrow state projection:
- Pool/token states are still persisted in backend store and updated from API flow.
- There is not yet a continuous reconciliation worker rebuilding state from chain events.

## 3) Major gaps vs target business model

1. Chain-state reconciliation is still missing.
- Contract exists and backend/frontend support escrow tx verification.
- Remaining work: rebuild authoritative state from chain events and continuously reconcile backend projections.

2. Per-pool on-chain claim token/collateral is missing.
- Current claim accounting is in backend store (`walletLockedBalances`) and not an on-chain token object.
- This means refund entitlement is trusted to backend state, not autonomous on-chain proof.

3. Smart contract scope is still narrower than full business model.
- `contracts/sources/passport.move` currently provides:
  - `SiteNFT`,
  - `DocProof`,
  - `ReservationToken`.
- `contracts/sources/pool_escrow.move` now adds fundraising escrow + receipts + refund/withdraw constraints, but there is no claim-token economics layer yet.

4. Remote compute provisioning plane is still missing.
- Renting updates platform state and capacities.
- It does not yet provision actual remote instances, credentials, network policy, metering, or SLA enforcement.

## 4) Alignment of requested workflow phases

1. Phase A (first pool + site onboarding):
- Implemented with admin site registration and admin pool creation using selected site.

2. Phase B (post-100% acquisition docs):
- Implemented in policy: acquisition doc allowed only for funded/acquired/operational pools.
- Admin UI now filters dropdown accordingly.

3. Phase C (services exposure based on acquired pools and capacity):
- Compute offer activation only for acquired/operational pools.
- Rental availability now auto-recovers after expiry.

4. Phase D (funding failure refund rights):
- Implemented in backend workflow.
- Enforced by on-chain escrow flow (`pool_escrow::refund`) when on-chain contributions are enabled.

## 5) What must be built next for full target coherence

1. Chain reconciliation/indexing service:
- Build worker to consume `ContributionAccepted`, `PoolFunded`, `RefundClaimed`, `PoolWithdrawn`.
- Reconstruct `raised`, `funded`, `refunded`, and receipt states from chain as source of truth.

2. Optional per-pool claim token design:
- Either NFT/receipt object per contribution,
- or fungible claim token with deterministic burn-on-refund.

3. Backend integration with escrow contract events/state:
- Read authoritative pool state from chain.
- Use backend storage only as projection/cache, not source of truth.

4. Compute delivery control plane:
- Reservation -> provisioning -> credentials -> runtime metering -> deprovision pipeline.

## 6) Immediate operational checks for explorer visibility

1. Set `MOCK_IOTA=false`.
2. Configure `IOTA_PACKAGE_ID`, `IOTA_ESCROW_PACKAGE_ID` and `IOTA_SIGNER_SECRET_KEY`.
3. Ensure each site has valid `iotaSiteObjectId` (or mint through `/api/admin/sites`).
4. Set `USE_IOTA_ESCROW=true` and `REQUIRE_ONCHAIN_CONTRIBUTION=true` for trustless contribution/refund flow.
5. Use proof detail page: if `chainMode=live`, tx link should open on explorer.
