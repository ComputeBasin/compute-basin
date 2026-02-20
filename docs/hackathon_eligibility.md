# ComputeBasin Hackathon Eligibility Notes

Date: 2026-02-18

## 1. Real-world problem solved

ComputeBasin addresses the financing and trusted activation of distributed compute infrastructure:

1. Real-estate and hardware projects need transparent fundraising.
2. Contributors need verifiable proof that legal/technical docs exist.
3. Buyers need clear outcomes: funded activation or refund when target is not reached.

## 2. IOTA Layer 1 usage already implemented

Current implementation uses IOTA L1 directly in backend + frontend flows:

1. Notarization on IOTA (`passport::notarize_document`) for pool documents and acquisition deed.
2. Wallet-signed on-chain IOTA payment for pool contribution.
3. On-chain transaction verification (`getTransactionBlock`) before contribution acceptance.
4. Optional backend-signed IOTA refund transaction for failed pools.

## 3. Core workflow now aligned with hackathon constraints

1. Pool has a funding deadline.
2. User contributes with IOTA transaction.
3. Backend credits locked custom tokens only after tx verification.
4. If pool is funded, tokens unlock.
5. If pool fails at deadline, refund path is enabled.

This creates an end-to-end L1-backed commercial workflow, not only mock state updates.

## 4. Recommended extension for stronger eligibility

Add IOTA Identity for issuer/compliance layer:

1. Store a DID per SRL/admin issuer.
2. Issue verifiable credential for KYC/KYB approval.
3. Require valid credential before admin actions (`/api/admin/*`) and before contributions in production mode.

This will combine economic settlement (IOTA tx) with identity-based access control.
