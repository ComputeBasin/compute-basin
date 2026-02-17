import type {
  ComputeOffer,
  Contribution,
  Meta,
  Pool,
  PoolSummary,
  Proof,
  Site,
  WalletSummary,
} from "../types/domain";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload as T;
}

function withWallet(walletAddress: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
  };
}

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
  documents: Array<{
    name: string;
    docType: string;
    driveUrl: string;
    docHashSha256?: string;
  }>;
}) {
  return fetchJson<{ pool: Pool }>(
    "/admin/pools",
    withWallet(
      input.walletAddress,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    )
  );
}

export async function contributeToPool(input: {
  walletAddress: string;
  poolId: string;
  tokenAmount: number;
}) {
  return fetchJson<{
    contribution: Contribution;
    pool: Pool;
    walletBalance: number;
  }>(
    `/pools/${input.poolId}/contribute`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: input.walletAddress,
        tokenAmount: input.tokenAmount,
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
  return fetchJson<{ pool: Pool; proof: Proof }>(
    `/admin/pools/${input.poolId}/acquisition-doc`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
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
  return fetchJson<{ pool: Pool; computeOffer: ComputeOffer }>(
    `/admin/pools/${input.poolId}/compute-offer`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
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
