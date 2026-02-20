import path from "node:path";

export const PORT = Number(process.env.PORT || 8787);
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
export const MOCK_IOTA =
  (process.env.MOCK_IOTA || "false").toLowerCase() === "true";

export const ADMIN_WALLET = (process.env.ADMIN_WALLET || "").toLowerCase();

export const IOTA_LIVE_NETWORKS = ["localnet", "testnet", "mainnet"];
export const IOTA_NETWORKS = ["mock", ...IOTA_LIVE_NETWORKS];
const rawIotaNetwork = (process.env.IOTA_NETWORK || "testnet").toLowerCase();
export const IOTA_NETWORK = IOTA_NETWORKS.includes(rawIotaNetwork)
  ? rawIotaNetwork
  : "testnet";
export const IOTA_FULLNODE_URL = process.env.IOTA_FULLNODE_URL || "";
export const IOTA_PACKAGE_ID = process.env.IOTA_PACKAGE_ID || "";
export const IOTA_SIGNER_SECRET_KEY = process.env.IOTA_SIGNER_SECRET_KEY || "";
export const IOTA_ESCROW_PACKAGE_ID =
  process.env.IOTA_ESCROW_PACKAGE_ID || IOTA_PACKAGE_ID || "";
export const USE_IOTA_ESCROW =
  (process.env.USE_IOTA_ESCROW || "false").toLowerCase() === "true";
const rawNotarizationProvider = (
  process.env.IOTA_NOTARIZATION_PROVIDER || "passport"
).toLowerCase();
export const IOTA_NOTARIZATION_PROVIDER =
  rawNotarizationProvider === "official" ||
  rawNotarizationProvider === "official_locked"
    ? "official_locked"
    : "passport";

const rawGasBudget = process.env.IOTA_GAS_BUDGET || "100000000";
export const IOTA_GAS_BUDGET = BigInt(rawGasBudget);

export const REQUIRE_ONCHAIN_CONTRIBUTION =
  (process.env.REQUIRE_ONCHAIN_CONTRIBUTION || "false").toLowerCase() ===
  "true";
const rawContributionPriceNanos =
  process.env.CONTRIBUTION_PRICE_NANOS || "1000000";
export const CONTRIBUTION_PRICE_NANOS = BigInt(rawContributionPriceNanos);
export const CONTRIBUTION_RECIPIENT_WALLET = (
  process.env.CONTRIBUTION_RECIPIENT_WALLET ||
  ADMIN_WALLET ||
  ""
).toLowerCase();

function scopedNetworkEnv(network, suffix) {
  return process.env[`IOTA_${network.toUpperCase()}_${suffix}`] || "";
}

function resolveProfileNetwork(network) {
  if (network !== "mock") {
    return network;
  }

  const rawBaseNetwork = (
    process.env.IOTA_MOCK_BASE_NETWORK || "testnet"
  ).toLowerCase();
  return IOTA_LIVE_NETWORKS.includes(rawBaseNetwork)
    ? rawBaseNetwork
    : "testnet";
}

export function normalizeIotaNetwork(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return IOTA_NETWORKS.includes(normalized) ? normalized : IOTA_NETWORK;
}

export function getIotaNetworkProfile(network = IOTA_NETWORK) {
  const selectedNetwork = normalizeIotaNetwork(network);
  const profileNetwork = resolveProfileNetwork(selectedNetwork);
  const isDefault = selectedNetwork === IOTA_NETWORK || profileNetwork === IOTA_NETWORK;

  const localnetDefaultUrl =
    process.env.IOTA_LOCALNET_FULLNODE_URL || "http://127.0.0.1:9000";
  const fullnodeUrl =
    scopedNetworkEnv(profileNetwork, "FULLNODE_URL") ||
    (profileNetwork === "localnet" ? localnetDefaultUrl : "") ||
    (isDefault ? IOTA_FULLNODE_URL : "");

  const packageId =
    scopedNetworkEnv(profileNetwork, "PACKAGE_ID") ||
    (isDefault ? IOTA_PACKAGE_ID : "");

  const escrowPackageId =
    scopedNetworkEnv(profileNetwork, "ESCROW_PACKAGE_ID") ||
    (isDefault ? IOTA_ESCROW_PACKAGE_ID : "") ||
    packageId ||
    "";

  const signerSecretKey =
    scopedNetworkEnv(profileNetwork, "SIGNER_SECRET_KEY") ||
    (isDefault ? IOTA_SIGNER_SECRET_KEY : "");

  return {
    network: selectedNetwork,
    profileNetwork,
    fullnodeUrl,
    packageId,
    escrowPackageId,
    signerSecretKey,
  };
}

export function getIotaProfilesStatus() {
  return IOTA_NETWORKS.map((network) => {
    const profile = getIotaNetworkProfile(network);
    return {
      network,
      hasFullnodeUrl: Boolean(profile.fullnodeUrl),
      hasPackageId: Boolean(profile.packageId),
      hasEscrowPackageId: Boolean(profile.escrowPackageId),
      hasSignerSecretKey: Boolean(profile.signerSecretKey),
    };
  });
}

export const ROOT_DIR = process.cwd();

export function getStorePath() {
  return process.env.STORE_PATH || path.join(ROOT_DIR, "data", "store.json");
}
