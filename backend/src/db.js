import { promises as fs } from "node:fs";
import { STORE_PATH } from "./config.js";

function normalizeStore(raw) {
  const store = {
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    pools: Array.isArray(raw.pools) ? raw.pools : [],
    proofs: Array.isArray(raw.proofs) ? raw.proofs : [],
    contributions: Array.isArray(raw.contributions) ? raw.contributions : [],
    walletBalances:
      raw.walletBalances && typeof raw.walletBalances === "object"
        ? raw.walletBalances
        : {},
    computeOffers: Array.isArray(raw.computeOffers) ? raw.computeOffers : [],
    rentals: Array.isArray(raw.rentals) ? raw.rentals : [],
  };

  return store;
}

export async function readStore() {
  const raw = await fs.readFile(STORE_PATH, "utf8");
  return normalizeStore(JSON.parse(raw));
}

export async function writeStore(store) {
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
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

export function creditWallet(store, walletAddress, amount) {
  const key = walletAddress.toLowerCase();
  const current = Number(store.walletBalances[key] || 0);
  store.walletBalances[key] = current + Number(amount);
  return store.walletBalances[key];
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
