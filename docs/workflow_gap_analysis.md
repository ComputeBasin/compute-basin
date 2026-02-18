# ComputeBasin - Workflow and Gap Analysis

**Date:** February 18, 2026

## 1. Objective Coverage Snapshot

| Objective | Status | Notes |
|---|---|---|
| Fundraising pools | Implemented | Legacy flow operational and test-covered. |
| Compute rental purchase flow | Implemented (transactional) | Legacy flow supports listing + rent + wallet deduction. |
| RBAC model for platform governance | Implemented (phase-1) | Properties/tokens/pools/compute routes separated by namespace. |
| IOTA notarization integration | Implemented (mock/live adapter) | Used in admin document flow. |
| Real remote compute delivery after payment | Not implemented | Token purchase currently updates backend store; no provisioning plane yet. |
| Enterprise-grade operations (SLA, support, metering, compliance) | Not implemented | Required for market competitiveness and trust. |

## 2. What Is Missing for Real Market Readiness

## 2.1 Product and Commercial

1. **SKU catalog and standardized offers**
- Need immutable SKU definitions: GPU model, vRAM, CPU, RAM, SSD, bandwidth, region, SLA tier.

2. **Quote + FX risk management**
- If paid in IOTA, EUR/USD pricing must be locked for a window.
- Need quote expiry, slippage policy, partial-fill policy.

3. **Service-level definitions**
- Availability target, support response times, compensation rules.

## 2.2 Core Platform Capabilities

1. **Provisioning control-plane**
- After purchase, resources must be reserved and provisioned automatically.
- Current backend has no allocator/scheduler/provisioner.

2. **Tenant identity and access system**
- Need tenant account model, project model, API keys, SSH key management.

3. **Network and isolation model**
- VPC/VLAN, private subnet, egress rules, security groups, firewall policy.

4. **Persistent storage lifecycle**
- Volume creation/attachment/snapshot/delete policies.

5. **Usage metering**
- Collect actual runtime, bandwidth, storage, and overage metrics.

## 2.3 Compliance and Risk

1. **KYC/KYB + sanctions screening** for paid infrastructure usage.
2. **Abuse prevention** (crypto-mining policy, DDoS, malware workloads).
3. **Tax and invoicing** (VAT and legal invoice generation).
4. **Data protection controls** (retention and deletion guarantees).

## 2.4 Reliability and Operations

1. Observability stack (metrics, logs, traces).
2. Incident management and on-call operations.
3. Capacity forecasting and admission control.
4. Backup/disaster recovery for control-plane data.

## 3. Critical Workflow: "3 GPUs for 1 month + 4TB SSD"

## 3.1 Inputs Required Beyond Token Payment

A buyer must provide at least:

1. **Account identity**
- Organization or individual profile, billing identity, compliance status.

2. **Technical access material**
- SSH public key(s) or identity provider setup (OIDC/SAML).

3. **Workload deployment info**
- VM image/container image, CUDA/runtime requirements, ports.

4. **Network preferences**
- Public vs private access, IP allowlist, VPN requirement.

5. **Operational contacts**
- Technical owner + incident escalation contact.

## 3.2 Proposed End-to-End Execution Flow

1. **Catalog selection**
- User chooses SKU: `GPU_TYPE`, `GPU_COUNT=3`, `SSD=4TB`, `TERM=1 month`, `region`.

2. **Pre-check**
- Capacity check + tenant eligibility + policy checks.

3. **Quote lock**
- Backend creates signed quote (price in IOTA + expiry + SLA terms).

4. **Payment authorization**
- User pays/escrows IOTA; backend verifies transaction finality.

5. **Resource reservation**
- Scheduler reserves exact hosts/cluster slots and storage volume.

6. **Provisioning**
- Provision VMs/containers + attach SSD + apply network rules.

7. **Credential delivery**
- Return endpoint(s), SSH access method, API token, start/end time.

8. **Runtime operations**
- Monitor usage/health; expose usage dashboard and billing evidence.

9. **Term completion**
- Notify expiry, optional extension, deprovision, secure data wipe policy.

## 3.3 Minimum Components Needed to Support This

1. **Order service** (quote, reservation, state machine).
2. **Payment bridge service** (on-chain event ingestion, confirmation).
3. **Provisioner service** (Terraform/Ansible/Kubernetes/OpenStack integration).
4. **Access service** (keys, VPN, IAM tokens).
5. **Metering service** (resource and SLA accounting).

## 4. Architecture Delta Needed from Current Codebase

Current code handles marketplace transactions at business level, but lacks real infrastructure orchestration.

Required additions:

1. `backend/src/services/provisioning/` for allocator + provisioner adapters.
2. `backend/src/services/billing/` for quote lock and settlement ledger.
3. `backend/src/services/access/` for credential lifecycle.
4. `backend/src/services/metering/` for actual usage ingestion.
5. `backend/src/routes/orders.js` for order lifecycle API.

## 5. Priority Roadmap

## Phase A (Immediate MVP Hardening)

1. Introduce order state machine: `quoted -> paid -> provisioning -> active -> completed`.
2. Add quote expiry and deterministic price lock policy.
3. Add tenant profile + SSH key registration API.
4. Add first provisioning adapter (even mock but with strict interfaces).

## Phase B (Operational MVP)

1. Implement real host allocator and network policy application.
2. Implement metering ingestion and customer usage view.
3. Add support playbook + incident response process.

## Phase C (Scale and Trust)

1. Compliance and abuse controls.
2. SLA enforcement and automated credits.
3. Multi-region capacity planning and failover.

## 6. Immediate Recommendation

Treat blockchain payment as the **commercial trigger**, not the full service delivery mechanism.
Remote compute delivery needs an off-chain control-plane with strict provisioning, access, and metering guarantees.

Without this layer, token purchases can be recorded, but reliable enterprise-grade compute access cannot be guaranteed.
