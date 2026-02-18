# ComputeBasin

**Decentralized Compute Infrastructure Platform**

Tokenize physical compute properties (capannoni/data centers) and enable fractional ownership with revenue sharing.

## What is ComputeBasin?

- **Phase 1**: SRL members upload properties and create fundraising pools
- **Phase 2**: Investors contribute IOTA and collectively acquire property + hardware
- **Phase 3**: Compute users rent hardware by location
- **Phase 4**: Revenue automatically distributed to token holders
- **All transactions** notarized on IOTA blockchain

## Architecture

- `backend/`: Express.js API with legacy marketplace routes (`/api/...`) and RBAC phase-1 routes (`/api/rbac/...`, `/api/properties`, `/api/hardware-specs`, `/api/tokens`)
- `landing-page/`: React 19 + TypeScript frontend
- `contracts/`: Move smart contracts on IOTA

## Quick Start

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (new terminal)
cd landing-page && npm install && npm run dev
```

Open http://localhost:5173

## CI/CD

GitHub Actions workflows:

- `CI` (`.github/workflows/ci.yml`): runs backend tests and frontend build on push/PR.
- `CD` (`.github/workflows/cd.yml`): on `main` (or manual run), builds and uploads:
  - backend package artifact
  - frontend `dist` artifact

## Analysis Docs

- Workflow and market gap analysis: `docs/workflow_gap_analysis.md`
- Hackathon eligibility notes: `docs/hackathon_eligibility.md`
