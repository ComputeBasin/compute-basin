export type Site = {
  id: string;
  name: string;
  siteType: string;
  areaM2: number;
  targetKw: number;
  approxLocation: string;
  owner: string;
  computeReady: boolean;
  status: string;
  tags: string[];
  iotaSiteObjectId?: string;
};

export type Proof = {
  id: string;
  poolId?: string;
  siteId: string;
  name: string;
  docType: string;
  driveUrl: string;
  docHashSha256: string;
  issuer: string;
  timestampMs: number;
  iotaObjectId: string;
  iotaTxDigest: string;
  chainMode: "mock" | "live";
};

export type Pool = {
  id: string;
  siteId: string;
  title: string;
  description: string;
  location: string;
  status: "open" | "funded" | "acquired" | "operational";
  createdAtMs: number;
  landValueTokens: number;
  surplusTokens: number;
  hardCapTokens: number;
  raisedTokens: number;
  tokenSymbol: string;
  percentage: number;
  remainingTokens: number;
  acquisitionProofId: string | null;
  computeOfferId: string | null;
};

export type PoolSummary = Pool & {
  site: Site | null;
  docsCount: number;
};

export type Contribution = {
  id: string;
  poolId: string;
  walletAddress: string;
  tokenAmount: number;
  timestampMs: number;
};

export type ComputeOffer = {
  id: string;
  poolId: string;
  siteId: string;
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
  availableUnits: number;
  tokensPerUnitHour: number;
  docs: Array<Record<string, unknown>>;
  status: "active";
  updatedAtMs: number;
  pool: Pool | null;
  site: Site | null;
};

export type WalletSummary = {
  walletAddress: string;
  tokenBalance: number;
  contributions: Contribution[];
  rentals: Array<Record<string, unknown>>;
};

export type Meta = {
  adminWallet: string | null;
};
