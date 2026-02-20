import { promises as fs } from "node:fs";
import { getStorePath, IOTA_NETWORK, normalizeIotaNetwork } from "./config.js";

function normalizeStore(raw) {
  const runtimeConfigRaw =
    raw.runtimeConfig && typeof raw.runtimeConfig === "object"
      ? raw.runtimeConfig
      : {};

  const store = {
    // Legacy structures (being phased out)
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    pools: Array.isArray(raw.pools) ? raw.pools : [],
    proofs: Array.isArray(raw.proofs) ? raw.proofs : [],
    contributions: Array.isArray(raw.contributions) ? raw.contributions : [],
    walletBalances:
      raw.walletBalances && typeof raw.walletBalances === "object"
        ? raw.walletBalances
        : {},
    walletLockedBalances:
      raw.walletLockedBalances && typeof raw.walletLockedBalances === "object"
        ? raw.walletLockedBalances
        : {},
    computeOffers: Array.isArray(raw.computeOffers) ? raw.computeOffers : [],
    rentals: Array.isArray(raw.rentals) ? raw.rentals : [],

    // New structures for refined ComputeBasin model
    properties: Array.isArray(raw.properties) ? raw.properties : [],
    hardwareSpecs: Array.isArray(raw.hardwareSpecs) ? raw.hardwareSpecs : [],
    userRoles: Array.isArray(raw.userRoles) ? raw.userRoles : [],
    assetTokens: Array.isArray(raw.assetTokens) ? raw.assetTokens : [],
    tokenAllocations: Array.isArray(raw.tokenAllocations)
      ? raw.tokenAllocations
      : [],
    userProfiles: Array.isArray(raw.userProfiles) ? raw.userProfiles : [],
    rbacPools: Array.isArray(raw.rbacPools) ? raw.rbacPools : [],
    rbacComputeOffers: Array.isArray(raw.rbacComputeOffers)
      ? raw.rbacComputeOffers
      : [],
    rbacRentals: Array.isArray(raw.rbacRentals) ? raw.rbacRentals : [],
    runtimeConfig: {
      activeIotaNetwork: normalizeIotaNetwork(
        runtimeConfigRaw.activeIotaNetwork || IOTA_NETWORK
      ),
    },
  };

  return store;
}

export async function readStore() {
  const raw = await fs.readFile(getStorePath(), "utf8");
  return normalizeStore(JSON.parse(raw));
}

export async function writeStore(store) {
  await fs.writeFile(getStorePath(), JSON.stringify(store, null, 2), "utf8");
}

export function getSiteOrThrow(store, siteId) {
  const site = store.sites.find((item) => item.id === siteId);
  if (!site) {
    const error = new Error(`Site ${siteId} not found`);
    error.status = 404;
    throw error;
  }
  return site;
}

export function getPoolOrThrow(store, poolId) {
  const pool = store.pools.find((item) => item.id === poolId);
  if (!pool) {
    const error = new Error(`Pool ${poolId} not found`);
    error.status = 404;
    throw error;
  }
  return pool;
}

export function getWalletBalance(store, walletAddress) {
  if (!walletAddress) {
    return 0;
  }
  return Number(store.walletBalances[walletAddress.toLowerCase()] || 0);
}

export function getWalletLockedBalance(store, walletAddress) {
  if (!walletAddress) {
    return 0;
  }
  return Number(store.walletLockedBalances[walletAddress.toLowerCase()] || 0);
}

export function creditWallet(store, walletAddress, amount) {
  const key = walletAddress.toLowerCase();
  const current = Number(store.walletBalances[key] || 0);
  store.walletBalances[key] = current + Number(amount);
  return store.walletBalances[key];
}

export function creditLockedWallet(store, walletAddress, amount) {
  const key = walletAddress.toLowerCase();
  const current = Number(store.walletLockedBalances[key] || 0);
  store.walletLockedBalances[key] = current + Number(amount);
  return store.walletLockedBalances[key];
}

export function debitWallet(store, walletAddress, amount) {
  const key = walletAddress.toLowerCase();
  const current = Number(store.walletBalances[key] || 0);
  if (current < Number(amount)) {
    const error = new Error("Insufficient token balance");
    error.status = 400;
    throw error;
  }
  store.walletBalances[key] = current - Number(amount);
  return store.walletBalances[key];
}

export function debitLockedWallet(store, walletAddress, amount) {
  const key = walletAddress.toLowerCase();
  const current = Number(store.walletLockedBalances[key] || 0);
  if (current < Number(amount)) {
    const error = new Error("Insufficient locked token balance");
    error.status = 400;
    throw error;
  }
  store.walletLockedBalances[key] = current - Number(amount);
  return store.walletLockedBalances[key];
}

export function moveLockedToAvailableWallet(store, walletAddress, amount) {
  debitLockedWallet(store, walletAddress, amount);
  return creditWallet(store, walletAddress, amount);
}
