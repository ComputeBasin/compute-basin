import type {
  ComputeOffer,
  Contribution,
  IotaNetwork,
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

export async function setAdminIotaNetwork(input: {
  walletAddress: string;
  network: IotaNetwork;
}) {
  return fetchJson<{
    activeNetwork: IotaNetwork;
    runtime: {
      activeNetwork: IotaNetwork;
      rpcUrl: string;
      packageId: string | null;
      escrowPackageId: string | null;
      hasSigner: boolean;
      signerAddress: string | null;
    };
  }>(
    "/admin/iota/network",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        network: input.network,
      }),
    })
  );
}

export async function getSites() {
  const data = await fetchJson<{ sites: Site[] }>("/sites");
  return data.sites;
}

export async function createSite(input: {
  walletAddress: string;
  id?: string;
  name: string;
  siteType: string;
  areaM2: number;
  targetKw: number;
  approxLocation: string;
  owner?: string;
  computeReady?: boolean;
  status?: string;
  tags?: string[];
  mintOnIota?: boolean;
  iotaSiteObjectId?: string;
}) {
  return fetchJson<{ site: Site }>(
    "/admin/sites",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
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
  refundTxDigest?: string;
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
        refundTxDigest: input.refundTxDigest,
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

export async function finalizePoolDocuments(input: {
  walletAddress: string;
  poolId: string;
  documents: Array<{
    name: string;
    docType: string;
    driveUrl: string;
    docHashSha256?: string;
  }>;
}) {
  const poolId = input.poolId?.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }
  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    throw new Error("documents array is required");
  }

  return fetchJson<{
    pool: Pool;
    proofs: Proof[];
    notarization: {
      txDigest: string | null;
      chainMode: "mock" | "live";
      provider: string;
      signedBy: string | null;
      proofCount: number;
    };
  }>(
    `/admin/pools/${poolId}/documents/finalize`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        documents: input.documents,
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

export async function verifyProofHash(input: {
  proofId: string;
  docHashSha256: string;
}) {
  return fetchJson<{
    proofId: string;
    expectedHash: string;
    providedHash: string;
    hashAlgorithm: string;
    match: boolean;
    chainMode: "mock" | "live" | null;
    iotaTxDigest: string | null;
  }>(`/proofs/${input.proofId}/verify-hash`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      docHashSha256: input.docHashSha256,
    }),
  });
}
