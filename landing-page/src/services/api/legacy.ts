import type {
  ComputeOffer,
  Contribution,
  Meta,
  Pool,
  PoolSummary,
  Proof,
  Site,
  WalletSummary,
} from "../../types/domain";
import { fetchJson, withWallet } from "./client";

// ============================================================================
// LEGACY ENDPOINTS — currently used by HomePage/AdminPage
// ============================================================================

export async function getMeta() {
  return fetchJson<Meta>("/meta");
}

export async function getSites() {
  const data = await fetchJson<{ sites: Site[] }>("/sites");
  return data.sites;
}

export async function getPools() {
  const data = await fetchJson<{ pools: PoolSummary[] }>("/pools");
  return data.pools;
}

export async function getPool(poolId: string) {
  return fetchJson<{
    pool: Pool;
    site: Site;
    contributions: Contribution[];
    proofs: Proof[];
  }>(`/pools/${poolId}`);
}

export async function createPool(input: {
  walletAddress: string;
  siteId: string;
  title: string;
  description: string;
  location: string;
  landValueTokens: number;
  surplusTokens: number;
  fundingDurationDays?: number;
  documents: Array<{
    name: string;
    docType: string;
    driveUrl: string;
    docHashSha256?: string;
  }>;
}) {
  return fetchJson<{ pool: Pool }>(
    "/admin/pools",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function contributeToPool(input: {
  walletAddress: string;
  poolId: string;
  tokenAmount: number;
  paymentTxDigest?: string;
}) {
  const poolId = input.poolId?.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }

  return fetchJson<{
    contribution: Contribution;
    pool: Pool;
    walletBalance: number;
    lockedWalletBalance: number;
  }>(
    `/pools/${poolId}/contribute`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: input.walletAddress,
        tokenAmount: input.tokenAmount,
        paymentTxDigest: input.paymentTxDigest,
      }),
    })
  );
}

export async function refundPoolContribution(input: {
  walletAddress: string;
  poolId: string;
}) {
  const poolId = input.poolId?.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }

  return fetchJson<{
    pool: Pool;
    refundedTokenAmount: number;
    refundedNanoIota: string | null;
    refundTxDigest: string | null;
    walletBalance: number;
    lockedWalletBalance: number;
  }>(
    `/pools/${poolId}/refund`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: input.walletAddress,
      }),
    })
  );
}

export async function addAcquisitionDoc(input: {
  walletAddress: string;
  poolId: string;
  name: string;
  driveUrl: string;
  docHashSha256?: string;
}) {
  const poolId = input.poolId?.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }

  return fetchJson<{ pool: Pool; proof: Proof }>(
    `/admin/pools/${poolId}/acquisition-doc`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        poolId,
      }),
    })
  );
}

export async function upsertComputeOffer(input: {
  walletAddress: string;
  poolId: string;
  region: string;
  hardware: {
    gpuModel: string;
    gpuCount: number;
    ramGb: number;
    storageType: string;
    storageTb: number;
    notes?: string;
  };
  totalUnits: number;
  tokensPerUnitHour: number;
  documents: Array<{
    name: string;
    driveUrl: string;
  }>;
}) {
  const poolId = input.poolId?.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }

  return fetchJson<{ pool: Pool; computeOffer: ComputeOffer }>(
    `/admin/pools/${poolId}/compute-offer`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        poolId,
      }),
    })
  );
}

export async function getComputeOffers(location?: string) {
  const query = location ? `?location=${encodeURIComponent(location)}` : "";
  const data = await fetchJson<{ offers: ComputeOffer[] }>(`/compute/offers${query}`);
  return data.offers;
}

export async function rentCompute(input: {
  walletAddress: string;
  offerId: string;
  units: number;
  hours: number;
}) {
  return fetchJson<{
    rental: Record<string, unknown>;
    walletBalance: number;
    availableUnits: number;
  }>(
    "/compute/rent",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function getWalletSummary(walletAddress: string) {
  return fetchJson<WalletSummary>(`/wallets/${walletAddress}/summary`);
}

export async function getProof(proofId: string) {
  const data = await fetchJson<{ proof: Proof }>(`/proofs/${proofId}`);
  return data.proof;
}
