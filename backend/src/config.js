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

const rawGasBudget = process.env.IOTA_GAS_BUDGET || "100000000";
export const IOTA_GAS_BUDGET = BigInt(rawGasBudget);

export const ROOT_DIR = process.cwd();

export function getStorePath() {
  return process.env.STORE_PATH || path.join(ROOT_DIR, "data", "store.json");
}
