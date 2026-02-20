// ============================================================================
// USER & PROFILE TYPES
// ============================================================================

export type UserProfile = {
  id: string;
  walletAddress: string;
  roles: Array<"admin" | "srl" | "investor" | "compute_user">;
  name?: string;
  email?: string;
  companyName?: string; // For SRL members
  kycStatus: "pending" | "verified" | "rejected";
  createdAtMs: number;
  updatedAtMs: number;
};

// ============================================================================
// PROPERTY TYPES
// ============================================================================

export type PropertySpecification = {
  areaM2: number;
  buildingType: "capannone" | "data_center" | "warehouse" | "land";
  constructionYear?: number;
  roofType?: string;
  floorCondition?: string;
  powerAvailable?: number; // kW
  coolingCapacity?: "none" | "basic" | "advanced" | "enterprise";
  fiberAccess: boolean;
  accessibility: "easy" | "moderate" | "difficult";
  notes?: string;
};

export type PropertyDocument = {
  id: string;
  type:
    | "title_deed"
    | "cadastral_map"
    | "structural_assessment"
    | "environmental_report"
    | "permits"
    | "photos"
    | "other";
  name: string;
  driveUrl: string;
  docHashSha256: string;
  uploadedAtMs: number;
};

export type Property = {
  id: string;
  name: string;
  description: string;
  location: {
    address: string;
    city: string;
    region: string;
    country: string;
    coordinates?: { lat: number; lng: number };
  };
  specs: PropertySpecification;
  documents: PropertyDocument[];
  srlWalletAddress: string;
  status: "draft" | "active" | "archived";
  createdAtMs: number;
  updatedAtMs: number;
  iotaPropertyObjectId?: string; // NFT reference when minted on-chain
};

// ============================================================================
// HARDWARE & INFRASTRUCTURE TYPES
// ============================================================================

export type HardwareComponent = {
  type: "gpu" | "cpu" | "ram" | "storage" | "network" | "other";
  model: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string;
};

export type HardwareSpec = {
  id: string;
  propertyId: string;
  name: string;
  components: HardwareComponent[];
  totalCost: number;
  expectedLifeYears: number;
  warrantyYears: number;
  maintenanceMonthly: number;
  replacementFund: number; // Total amount set aside for replacement
  notes?: string;
};

// ============================================================================
// TOKEN & ASSET TYPES
// ============================================================================

export type AssetToken = {
  id: string;
  symbol: string; // e.g., "CMN" for Capannone Milano Nord
  name: string;
  totalSupply: number;
  price: number; // Price per token in EUR or IOTA
  propertyId: string;
  poolId: string;
  iotaTokenId?: string; // Reference to on-chain Move token
  status: "created" | "active" | "deprecated";
  createdAtMs: number;
};

export type TokenAllocation = {
  walletAddress: string;
  tokenId: string;
  amount: number;
  allocationType: "purchased" | "staked" | "earned" | "airdrop";
  transactionHash?: string;
  allocatedAtMs: number;
};

// ============================================================================
// POOL & FUNDRAISING TYPES
// ============================================================================

export type PoolPhase = "fundraising" | "funded" | "acquired" | "operational" | "closed";

export type Pool = {
  id: string;
  propertyId: string;
  tokenId: string;
  title: string;
  description: string;

  // Fundraising details
  phase: PoolPhase;
  fundingGoalTokens: number;
  fundedTokens: number;
  fundingDeadlineMs: number; // Timestamp

  // Financial breakdown
  propertyPriceEur: number;
  hardwareCostEur: number;
  installationCostEur: number;
  totalFundingEur: number;

  // Revenue model
  revenueSplitPercent: {
    tokenHolders: number; // 60%
    maintenance: number; // 20%
    insurance: number; // 10%
    platformFee: number; // 10%
  };

  // Acquisition & Operations
  acquisitionProofId?: string;
  operationalStartDateMs?: number;
  monthlyRevenueForecast?: number;

  createdAtMs: number;
  fundedAtMs?: number;
  acquiredAtMs?: number;
  operationalAtMs?: number;
};

export type PoolSummary = {
  id: string;
  title: string;
  description: string;
  location: string;
  status: "open" | "funded" | "acquired" | "operational" | "closed" | "failed";
  site: Site | null;
  landValueTokens: number;
  surplusTokens: number;
  hardCapTokens: number;
  raisedTokens: number;
  percentage: number; // 0-100
  fundingStartMs?: number;
  fundingDeadlineMs?: number | null;
  fundingRemainingMs?: number | null;
  isFundingExpired?: boolean;
  isRefundOpen?: boolean;
  refundedTokens?: number;
  docsCount: number;
  proofs?: Array<{
    id: string;
    name: string;
    docType: string;
    iotaTxDigest: string | null;
    chainMode: "mock" | "live" | null;
    timestampMs: number | null;
  }>;
  tokenSymbol: string;
  createdAtMs: number;
  acquisitionProofId?: string;
  iotaEscrowObjectId?: string | null;
  iotaEscrowTxDigest?: string | null;
  iotaEscrowChainMode?: "mock" | "live" | null;
  iotaEscrowProvider?: string | null;
  iotaEscrowPackageId?: string | null;
};

// ============================================================================
// CONTRIBUTION & WALLET TYPES
// ============================================================================

export type Contribution = {
  id: string;
  poolId: string;
  tokenId?: string;
  walletAddress: string;
  tokenAmount: number;
  valueEur?: number;
  paymentMode?: "onchain" | "onchain_escrow" | "offchain";
  tokenSettlementMode?: "locked" | "liquid";
  tokensReleasedAtMs?: number;
  transactionHash?: string;
  paymentTxDigest?: string;
  paymentAmountNanoIota?: string;
  expectedPaymentAmountNanoIota?: string;
  paymentRecipientWallet?: string;
  paymentCoinType?: string;
  escrowReceiptObjectId?: string | null;
  refundedAtMs?: number;
  refundReason?: string;
  refundTxDigest?: string;
  refundAmountNanoIota?: string;
  timestampMs: number;
};

export type WalletBalance = {
  tokenId: string;
  amount: number;
  valueEur?: number;
};

export type WalletSummary = {
  walletAddress: string;
  tokenBalance: number;
  lockedTokenBalance?: number;
  contributions: Contribution[];
  rentals: ComputeRental[];
};

// ============================================================================
// COMPUTE RENTAL TYPES
// ============================================================================

export type HardwareAvailability = {
  componentType: string;
  available: number;
  reserved: number;
  total: number;
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
  pool: PoolSummary | null;
  site: Site | null;
  docs: PropertyDocument[];
  status: "planning" | "active" | "maintenance" | "closed";
  updatedAtMs: number;
};

export type ComputeRental = {
  id: string;
  offerId: string;
  tokenId: string;
  walletAddress: string;
  startDateMs: number;
  endDateMs: number;
  duration: "hourly" | "weekly" | "monthly";
  costInIota?: number;
  costInEur?: number;
  hardware: {
    gpuUnits?: number;
    cpuUnits?: number;
    ramGb?: number;
    storageGb?: number;
  };
  status: "scheduled" | "active" | "completed" | "cancelled";
  createdAtMs: number;
};

// ============================================================================
// FINANCIAL & REPORTING TYPES
// ============================================================================

export type RevenueDistribution = {
  id: string;
  tokenId: string;
  month: string; // "2026-02"
  grossRevenue: number;
  costs: {
    maintenance: number;
    insurance: number;
    other: number;
  };
  netRevenue: number;
  perTokenShare: number;
  distributedAtMs: number;
};

export type PoolFinancials = {
  tokenId: string;
  totalInvested: number;
  totalInvestedEur: number;
  revenueGenerated: number;
  revenueDistributed: number;
  roiPercent: number;
  roi30days?: number;
  roi90days?: number;
  roi1year?: number;
};

// ============================================================================
// DOCUMENT & PROOF TYPES
// ============================================================================

export type Proof = {
  id: string;
  poolId?: string;
  propertyId?: string;
  name: string;
  docType: string;
  driveUrl: string;
  docHashSha256: string;
  issuer: string;
  timestampMs: number;
  iotaObjectId?: string;
  iotaTxDigest?: string;
  iotaSignedBy?: string | null;
  notarizationProvider?: string;
  batchIndex?: number;
  chainMode: "mock" | "live";
};

// ============================================================================
// METADATA & SYSTEM TYPES
// ============================================================================

export type IotaNetwork = "mock" | "localnet" | "testnet" | "mainnet";

export type Meta = {
  adminWallet: string | null;
  iotaMode?: "mock" | "live";
  iotaActiveNetwork?: IotaNetwork;
  iotaAvailableNetworks?: IotaNetwork[];
  iotaRpcUrl?: string | null;
  iotaPackageId?: string | null;
  iotaProfiles?: Array<{
    network: IotaNetwork;
    hasFullnodeUrl: boolean;
    hasPackageId: boolean;
    hasEscrowPackageId: boolean;
    hasSignerSecretKey: boolean;
  }>;
  iotaBackendSigner?: string | null;
  notarizationProvider?: string;
  useIotaEscrow?: boolean;
  iotaEscrowPackageId?: string | null;
  notarizationSignerMatchesAdmin?: boolean | null;
  onChainContributionRequired?: boolean;
  contributionPriceNanoIota?: string;
  contributionRecipientWallet?: string | null;
  iotaPerToken?: string | null;
  tokensPerIota?: string | null;
  platformVersion?: string;
  lastUpdateMs?: number;
};

// Legacy Site type (for backwards compatibility during transition)
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
  iotaSiteTxDigest?: string | null;
  iotaChainMode?: "mock" | "live" | null;
  iotaNotarizationProvider?: string;
  createdAtMs?: number;
};
