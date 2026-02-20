import path from "node:path";

export const PORT = Number(process.env.PORT || 8787);
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
export const MOCK_IOTA =
  (process.env.MOCK_IOTA || "true").toLowerCase() === "true";

export const ADMIN_WALLET = (process.env.ADMIN_WALLET || "").toLowerCase();

export const IOTA_NETWORK = process.env.IOTA_NETWORK || "testnet";
export const IOTA_FULLNODE_URL = process.env.IOTA_FULLNODE_URL || "";
export const IOTA_PACKAGE_ID = process.env.IOTA_PACKAGE_ID || "";
export const IOTA_SIGNER_SECRET_KEY = process.env.IOTA_SIGNER_SECRET_KEY || "";
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

export const ROOT_DIR = process.cwd();

export function getStorePath() {
  return process.env.STORE_PATH || path.join(ROOT_DIR, "data", "store.json");
}
