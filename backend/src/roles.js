/**
 * Backend Role & Permission Middleware
 * Validates user roles and enforces access control.
 */

import { ADMIN_WALLET } from "./config.js";

function normalizeWallet(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

const permissions = {
  admin: {
    properties: ["manage"],
    pools: ["manage"],
    hardware_specs: ["manage"],
    tokens: ["manage"],
    compute_offers: ["manage"],
    rentals: ["manage"],
    contributions: ["manage"],
    portfolio: ["manage"],
    usage: ["manage"],
    acquisition_docs: ["manage"],
    financial: ["manage"],
    users: ["manage"],
    system: ["manage"],
  },
  srl: {
    properties: ["create", "read", "update", "delete"],
    pools: ["create", "read", "update"],
    hardware_specs: ["create", "read", "update", "delete"],
    compute_offers: ["create", "read", "update"],
    acquisition_docs: ["create", "read"],
    financial: ["read"],
    tokens: ["read"],
  },
  investor: {
    pools: ["read"],
    tokens: ["read"],
    contributions: ["create", "read"],
    financial: ["read"],
    portfolio: ["read"],
  },
  compute_user: {
    pools: ["read"],
    compute_offers: ["read"],
    rentals: ["create", "read"],
    usage: ["read"],
  },
  guest: {
    pools: ["read"],
    compute_offers: ["read"],
  },
};

/**
 * Get user roles from store (in-memory for PoC).
 */
export function getUserRoles(store, walletAddress) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet || !Array.isArray(store?.userRoles)) {
    return ["guest"];
  }

  const userRoles = store.userRoles.find(
    (entry) => normalizeWallet(entry.walletAddress) === normalizedWallet
  );

  if (!userRoles || !Array.isArray(userRoles.roles) || userRoles.roles.length === 0) {
    return ["guest"];
  }

  return userRoles.roles;
}

/**
 * Add/update user role.
 */
export function setUserRole(store, walletAddress, roles, kycStatus) {
  if (!store.userRoles) {
    store.userRoles = [];
  }

  const normalizedWallet = normalizeWallet(walletAddress);
  const normalizedRoles = Array.from(
    new Set(Array.isArray(roles) ? roles.filter((role) => typeof role === "string") : [])
  );

  const index = store.userRoles.findIndex(
    (entry) => normalizeWallet(entry.walletAddress) === normalizedWallet
  );

  if (index >= 0) {
    store.userRoles[index] = {
      walletAddress: normalizedWallet,
      roles: normalizedRoles,
      kycStatus,
      createdAtMs: store.userRoles[index].createdAtMs,
    };
  } else {
    store.userRoles.push({
      walletAddress: normalizedWallet,
      roles: normalizedRoles,
      kycStatus,
      createdAtMs: Date.now(),
    });
  }
}

/**
 * Middleware: Extract wallet address from request.
 */
export function extractWallet(req, _res, next) {
  const fromHeader = normalizeWallet(req.headers["x-wallet-address"]);
  const fromBody = normalizeWallet(req.body?.walletAddress);
  req.wallet = fromHeader || fromBody || "";
  next();
}

/**
 * Middleware: Require authentication (any wallet).
 */
export function requireAuth(req, res, next) {
  if (!req.wallet) {
    return res.status(401).json({ error: "Wallet address required" });
  }

  next();
}

/**
 * Middleware: Require specific roles.
 */
export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.wallet) {
      return res.status(401).json({ error: "Wallet address required" });
    }

    const userRoles = getUserRoles(req.store, req.wallet);
    const hasRole = userRoles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        error: "Insufficient permissions",
        requiredRoles: allowedRoles,
        userRoles,
      });
    }

    req.userRoles = userRoles;
    next();
  };
}

/**
 * Middleware: Require admin role.
 */
export function requireAdmin(req, res, next) {
  if (!req.wallet) {
    return res.status(401).json({ error: "Wallet address required" });
  }

  if (!ADMIN_WALLET) {
    return res.status(500).json({ error: "ADMIN_WALLET is not configured" });
  }

  if (req.wallet !== ADMIN_WALLET) {
    return res.status(403).json({ error: "Admin role required" });
  }

  req.userRoles = ["admin"];
  next();
}

/**
 * Middleware: Check single permission.
 */
export function checkPermission(resource, action) {
  return (req, res, next) => {
    const userRoles =
      Array.isArray(req.userRoles) && req.userRoles.length > 0
        ? req.userRoles
        : getUserRoles(req.store, req.wallet);

    req.userRoles = userRoles;

    const hasPermission = userRoles.some((role) => {
      const rolePerms = permissions[role];
      if (!rolePerms) return false;

      const resourcePerms = rolePerms[resource];
      if (!resourcePerms) return false;

      return resourcePerms.includes("manage") || resourcePerms.includes(action);
    });

    if (!hasPermission) {
      return res.status(403).json({
        error: "Permission denied",
        required: { resource, action },
        userRoles,
      });
    }

    next();
  };
}
