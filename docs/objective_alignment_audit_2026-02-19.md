# ComputeBasin Objective Alignment Audit

Date: 2026-02-19

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

## 2) What is partially implemented

1. Notarization visibility:
- Proofs are stored and retrievable from `/api/proofs/:proofId`.
- Explorer visibility depends on `chainMode`.
- If `MOCK_IOTA=true`, digests are synthetic and do not appear in explorer.

2. Compute documentation traceability:
- Compute offer docs are now notarized in legacy admin flow and attached as proofs.
- However there is no explicit legal schema enforcement (e.g. mandatory maintenance checklist format).

3. Treasury logic:
- Treasury wallet is configurable and contribution wallet must differ from treasury wallet.
- This is still backend policy, not on-chain escrow enforcement.

## 3) Major gaps vs target business model

1. Pool escrow contract per pool is missing.
- Current payment flow verifies a normal IOTA transfer to treasury.
- There is no on-chain vault state that enforces:
  - admin withdraw only when `raised >= hardCap`,
  - contributor refund rights after deadline if not funded.

2. Per-pool on-chain claim token/collateral is missing.
- Current claim accounting is in backend store (`walletLockedBalances`) and not an on-chain token object.
- This means refund entitlement is trusted to backend state, not autonomous on-chain proof.

3. Smart contract scope is narrower than required pool economics.
- `contracts/sources/passport.move` currently provides:
  - `SiteNFT`,
  - `DocProof`,
  - `ReservationToken`.
- It does not include fundraising escrow, contribution receipts, refund/withdraw policy logic.

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
- Not yet enforced by autonomous on-chain escrow contract.

## 5) What must be built next for full target coherence

1. New Move module `pool_escrow` with:
- Pool object (`hardCap`, `deadline`, `treasury`, `raised`, `status`).
- Contribution receipt object per wallet.
- `contribute`, `finalize_funded`, `refund_after_deadline`, `withdraw_if_funded` entry functions.

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
2. Configure `IOTA_PACKAGE_ID` and `IOTA_SIGNER_SECRET_KEY`.
3. Ensure each site has valid `iotaSiteObjectId` (or mint through `/api/admin/sites`).
4. Use proof detail page: if `chainMode=live`, tx link should open on explorer.
