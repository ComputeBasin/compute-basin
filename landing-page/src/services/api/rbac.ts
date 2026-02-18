import type { Property } from "../../types/domain";
import { fetchJson, withWallet } from "./client";

// ============================================================================
// PROPERTIES (RBAC)
// ============================================================================

export async function getProperties() {
  const data = await fetchJson<{ properties: Property[]; total: number }>("/properties");
  return data.properties;
}

export async function getProperty(propertyId: string) {
  const data = await fetchJson<{ property: Property }>(`/properties/${propertyId}`);
  return data.property;
}

export async function createProperty(input: {
  walletAddress: string;
  name: string;
  description?: string;
  location: object;
  specs: object;
  documents?: Array<Record<string, unknown>>;
}) {
  return fetchJson<{ property: Property }>(
    "/properties",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function updateProperty(input: {
  walletAddress: string;
  propertyId: string;
  name?: string;
  description?: string;
  location?: object;
  specs?: object;
  status?: "draft" | "active" | "archived";
}) {
  const { propertyId, ...data } = input;
  return fetchJson<{ property: Property }>(
    `/properties/${propertyId}`,
    withWallet(input.walletAddress, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  );
}

export async function deleteProperty(walletAddress: string, propertyId: string) {
  return fetchJson<{ message: string; property: Property }>(
    `/properties/${propertyId}`,
    withWallet(walletAddress, {
      method: "DELETE",
    })
  );
}

// ============================================================================
// HARDWARE SPECIFICATIONS (RBAC)
// ============================================================================

export async function getHardwareSpecs(propertyId?: string, type?: string) {
  let path = "/hardware-specs";
  const params = new URLSearchParams();
  if (propertyId) params.append("propertyId", propertyId);
  if (type) params.append("type", type);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await fetchJson<{ specs: unknown[]; total: number }>(path);
  return data.specs;
}

export async function getHardwareSpec(hardwareId: string) {
  const data = await fetchJson<{ hardware: unknown }>(`/hardware-specs/${hardwareId}`);
  return data.hardware;
}

export async function createHardwareSpec(input: {
  walletAddress: string;
  type: "cpu" | "gpu" | "memory" | "storage" | "network" | "other";
  name: string;
  description?: string;
  specifications: object;
  propertyId?: string;
  costPerUnit?: number;
  units?: string;
}) {
  return fetchJson<{ hardware: unknown }>(
    "/hardware-specs",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function updateHardwareSpec(input: {
  walletAddress: string;
  hardwareId: string;
  name?: string;
  description?: string;
  specifications?: object;
  costPerUnit?: number;
  units?: string;
  status?: "active" | "archived" | "deprecated";
}) {
  const { hardwareId, ...data } = input;
  return fetchJson<{ hardware: unknown }>(
    `/hardware-specs/${hardwareId}`,
    withWallet(input.walletAddress, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  );
}

export async function deleteHardwareSpec(walletAddress: string, hardwareId: string) {
  return fetchJson<{ message: string; hardware: unknown }>(
    `/hardware-specs/${hardwareId}`,
    withWallet(walletAddress, {
      method: "DELETE",
    })
  );
}

// ============================================================================
// ASSET TOKENS & ALLOCATIONS (RBAC)
// ============================================================================

export async function createToken(input: {
  walletAddress: string;
  propertyId: string;
  name: string;
  symbol: string;
  totalSupply: string;
  description?: string;
  decimals?: number;
}) {
  return fetchJson<{ token: unknown }>(
    "/tokens",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function getTokens(propertyId?: string, status?: string) {
  let path = "/tokens";
  const params = new URLSearchParams();
  if (propertyId) params.append("propertyId", propertyId);
  if (status) params.append("status", status);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await fetchJson<{ tokens: unknown[]; total: number }>(path);
  return data.tokens;
}

export async function getToken(tokenId: string) {
  const data = await fetchJson<{
    token: unknown;
    allocations: unknown[];
    allocationCount: number;
  }>(`/tokens/${tokenId}`);
  return data;
}

export async function allocateTokens(input: {
  walletAddress: string;
  tokenId: string;
  recipientWallet?: string | null;
  amount: string;
  purpose: "investor" | "srl_team" | "platform_fee" | "maintenance" | "insurance";
  vestingSchedule?: object;
}) {
  const { tokenId, recipientWallet, ...data } = input;
  return fetchJson<{ allocation: unknown }>(
    `/tokens/${tokenId}/allocate`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: recipientWallet,
        amount: data.amount,
        purpose: data.purpose,
        vestingSchedule: data.vestingSchedule,
      }),
    })
  );
}

export async function getTokenAllocations(tokenId: string, purpose?: string, wallet?: string) {
  let path = `/tokens/${tokenId}/allocations`;
  const params = new URLSearchParams();
  if (purpose) params.append("purpose", purpose);
  if (wallet) params.append("wallet", wallet);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await fetchJson<{
    tokenId: string;
    allocations: unknown[];
    total: number;
  }>(path);
  return data.allocations;
}

export async function getWalletTokenHoldings(walletAddress: string) {
  const data = await fetchJson<{
    walletAddress: string;
    holdings: Record<string, string>;
    tokenCount: number;
  }>(`/tokens/wallet/${walletAddress}/holdings`);
  return data;
}

export async function updateToken(input: {
  walletAddress: string;
  tokenId: string;
  name?: string;
  description?: string;
  status?: "active" | "paused" | "archived";
}) {
  const { tokenId, ...data } = input;
  return fetchJson<{ token: unknown }>(
    `/tokens/${tokenId}`,
    withWallet(input.walletAddress, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  );
}

// ============================================================================
// POOLS (RBAC)
// ============================================================================

export async function getPoolList(propertyId?: string, phase?: string, status?: string) {
  let path = "/rbac/pools";
  const params = new URLSearchParams();
  if (propertyId) params.append("propertyId", propertyId);
  if (phase) params.append("phase", phase);
  if (status) params.append("status", status);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await fetchJson<{ pools: unknown[]; total: number }>(path);
  return data.pools;
}

export async function updatePool(input: {
  walletAddress: string;
  poolId: string;
  title?: string;
  description?: string;
  fundingGoal?: string;
  targetFundingEndDate?: string;
  status?: "active" | "paused" | "archived";
}) {
  const { poolId, ...data } = input;
  return fetchJson<{ pool: unknown }>(
    `/rbac/pools/${poolId}`,
    withWallet(input.walletAddress, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  );
}

export async function transitionPoolPhase(input: {
  walletAddress: string;
  poolId: string;
  documentProof?: { id: string };
}) {
  const { poolId, ...data } = input;
  return fetchJson<{ pool: unknown; message: string }>(
    `/rbac/pools/${poolId}/transition-phase`,
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(data),
    })
  );
}

export async function getPoolStats(poolId: string) {
  return fetchJson<{
    poolId: string;
    phase: string;
    fundingGoal: string;
    fundingRaised: string;
    fundingProgress: string;
    fundingPercentage: string;
    investorCount: number;
    averageContribution: string;
    revenueDistribution: Record<string, number>;
  }>(`/rbac/pools/${poolId}/stats`);
}

// ============================================================================
// COMPUTE MARKETPLACE (RBAC)
// ============================================================================

export async function createComputeOffer(input: {
  walletAddress: string;
  hardwareSpecId: string;
  poolId: string;
  pricePerUnit: string;
  timeUnit: "hour" | "day" | "week" | "month";
  maxUnitsAvailable: number;
  description?: string;
  minimumRentalPeriod?: number;
}) {
  return fetchJson<{ offer: unknown }>(
    "/rbac/compute",
    withWallet(input.walletAddress, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function getComputeOffer(offerId: string) {
  return fetchJson<{
    offer: unknown;
    hardware: unknown;
    pool: unknown;
    property: unknown;
    activeRentals: number;
    totalRentals: number;
  }>(`/rbac/compute/${offerId}`);
}

export async function getOfferRentals(offerId: string, status?: string) {
  let path = `/rbac/compute/${offerId}/rentals`;
  const params = new URLSearchParams();
  if (status) params.append("status", status);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await fetchJson<{ offerId: string; rentals: unknown[]; total: number }>(path);
  return data.rentals;
}

export async function updateComputeOffer(input: {
  walletAddress: string;
  offerId: string;
  pricePerUnit?: string;
  description?: string;
  status?: "active" | "paused" | "archived";
}) {
  const { offerId, ...data } = input;
  return fetchJson<{ offer: unknown }>(
    `/rbac/compute/${offerId}`,
    withWallet(input.walletAddress, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  );
}

export async function getMarketplaceStats() {
  const data = await fetchJson<{
    marketplace: {
      totalOffers: number;
      activeOffers: number;
      totalRentals: number;
      activeRentals: number;
      totalRevenue: string;
      averagePricePerOffer: string;
    };
  }>("/rbac/compute/stats/marketplace");
  return data.marketplace;
}
