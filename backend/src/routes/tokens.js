import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../db.js";
import { requireRoles, requireAdmin, checkPermission } from "../roles.js";

const router = Router();

/**
 * Create a new asset token for a property
 * Admin only - tokens represent fractional ownership of a property
 * Required fields:
 *   - propertyId: Property this token represents
 *   - name: Token name (e.g., "Villa Rosa Pool Token")
 *   - symbol: Token symbol (e.g., "VRP")
 *   - totalSupply: Total number of tokens to be created
 *   - description: Description of the asset
 *   - decimals: Number of decimal places (typically 18)
 */
router.post(
  "/",
  requireAdmin,
  checkPermission("tokens", "create"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { propertyId, name, symbol, totalSupply, description, decimals } = req.body;

      // Validate required fields
      if (!propertyId || !name || !symbol || totalSupply === undefined) {
        return res.status(400).json({
          error: "Missing required fields: propertyId, name, symbol, totalSupply",
        });
      }

      // Verify property exists
      const property = store.properties?.find((p) => p.id === propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Check if token already exists for this property
      const existing = store.assetTokens?.find((t) => t.propertyId === propertyId);
      if (existing) {
        return res.status(409).json({
          error: "Token already exists for this property",
          token: existing,
        });
      }

      const tokenId = randomUUID();
      const now = new Date().toISOString();

      const newToken = {
        id: tokenId,
        propertyId,
        name,
        symbol,
        description: description || "",
        totalSupply: BigInt(totalSupply).toString(),
        circulatingSupply: "0",
        decimals: decimals || 18,
        createdBy: wallet,
        createdAt: now,
        status: "active",
        iota: {
          tokenAddress: null, // Will be set after blockchain deployment
          deployed: false,
        },
      };

      // Ensure assetTokens array exists
      if (!store.assetTokens) {
        store.assetTokens = [];
      }

      store.assetTokens.push(newToken);
      await writeStore(store);

      res.status(201).json({ token: newToken });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get all tokens, optionally filtered by property
 */
router.get("/", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { propertyId, status } = req.query;

    let tokens = store.assetTokens || [];

    if (propertyId) {
      tokens = tokens.filter((t) => t.propertyId === propertyId);
    }

    if (status) {
      tokens = tokens.filter((t) => t.status === status);
    }

    res.json({
      tokens,
      total: tokens.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get specific token details
 */
router.get("/:tokenId", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { tokenId } = req.params;

    const token = store.assetTokens?.find((t) => t.id === tokenId);

    if (!token) {
      return res.status(404).json({ error: "Token not found" });
    }

    // Get allocations for this token
    const allocations = (store.tokenAllocations || []).filter(
      (a) => a.tokenId === tokenId
    );

    res.json({
      token,
      allocations,
      allocationCount: allocations.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Allocate tokens to a wallet
 * Admin only - allocates portions of tokens to different wallets/purposes
 * Purposes: "investor", "srl_team", "platform_fee", "maintenance", "insurance"
 * Required fields:
 *   - tokenId: Target token
 *   - walletAddress: Recipient wallet (can be null for non-wallet allocations)
 *   - amount: Number of tokens to allocate
 *   - purpose: Allocation purpose/role
 */
router.post(
  "/:tokenId/allocate",
  requireAdmin,
  checkPermission("tokens", "manage"),
  async (req, res, next) => {
    try {
      const store = req.store || (await readStore());
      const { tokenId } = req.params;
      const { walletAddress, amount, purpose, vestingSchedule } = req.body;

      if (!amount || !purpose) {
        return res.status(400).json({
          error: "Missing required fields: amount, purpose",
        });
      }

      // Verify token exists
      const token = store.assetTokens?.find((t) => t.id === tokenId);
      if (!token) {
        return res.status(404).json({ error: "Token not found" });
      }

      // Verify allocation purpose
      const validPurposes = ["investor", "srl_team", "platform_fee", "maintenance", "insurance"];
      if (!validPurposes.includes(purpose)) {
        return res.status(400).json({
          error: `Invalid purpose. Must be one of: ${validPurposes.join(", ")}`,
        });
      }

      // Get total allocations for this token to check against supply
      const existingAllocations = (store.tokenAllocations || []).filter(
        (a) => a.tokenId === tokenId
      );
      const totalAllocated = existingAllocations.reduce(
        (sum, a) => sum + BigInt(a.amount),
        0n
      );

      const newAmount = BigInt(amount);
      const totalSupply = BigInt(token.totalSupply);

      if (totalAllocated + newAmount > totalSupply) {
        return res.status(400).json({
          error: "Allocation exceeds total token supply",
          available: (totalSupply - totalAllocated).toString(),
          requested: amount,
        });
      }

      const allocationId = randomUUID();
      const now = new Date().toISOString();

      const allocation = {
        id: allocationId,
        tokenId,
        walletAddress: walletAddress?.toLowerCase() || null,
        amount: amount.toString(),
        purpose,
        vestingSchedule: vestingSchedule || null,
        createdAt: now,
        status: "active",
      };

      // Ensure tokenAllocations array exists
      if (!store.tokenAllocations) {
        store.tokenAllocations = [];
      }

      store.tokenAllocations.push(allocation);

      // Update circulating supply
      token.circulatingSupply = (totalAllocated + newAmount).toString();
      await writeStore(store);

      res.status(201).json({ allocation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get allocations for a specific token
 */
router.get("/:tokenId/allocations", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { tokenId } = req.params;
    const { purpose, wallet } = req.query;

    // Verify token exists
    const token = store.assetTokens?.find((t) => t.id === tokenId);
    if (!token) {
      return res.status(404).json({ error: "Token not found" });
    }

    let allocations = (store.tokenAllocations || []).filter(
      (a) => a.tokenId === tokenId
    );

    if (purpose) {
      allocations = allocations.filter((a) => a.purpose === purpose);
    }

    if (wallet) {
      const normalizedWallet = wallet.toLowerCase();
      allocations = allocations.filter(
        (a) => a.walletAddress?.toLowerCase() === normalizedWallet
      );
    }

    res.json({
      tokenId,
      allocations,
      total: allocations.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get wallet's token holdings across all tokens
 */
router.get("/wallet/:walletAddress/holdings", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { walletAddress } = req.params;
    const normalizedWallet = walletAddress.toLowerCase();

    const allocations = (store.tokenAllocations || []).filter(
      (a) => a.walletAddress?.toLowerCase() === normalizedWallet
    );

    // Group by token
    const holdings = {};
    for (const alloc of allocations) {
      if (!holdings[alloc.tokenId]) {
        holdings[alloc.tokenId] = "0";
      }
      holdings[alloc.tokenId] = (
        BigInt(holdings[alloc.tokenId]) + BigInt(alloc.amount)
      ).toString();
    }

    res.json({
      walletAddress,
      holdings,
      tokenCount: Object.keys(holdings).length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update token metadata
 * Admin only
 */
router.put(
  "/:tokenId",
  requireAdmin,
  checkPermission("tokens", "update"),
  async (req, res, next) => {
    try {
      const store = req.store || (await readStore());
      const { tokenId } = req.params;
      const { name, description, status } = req.body;

      const token = store.assetTokens?.find((t) => t.id === tokenId);

      if (!token) {
        return res.status(404).json({ error: "Token not found" });
      }

      if (name !== undefined) token.name = name;
      if (description !== undefined) token.description = description;
      if (status !== undefined && ["active", "paused", "archived"].includes(status)) {
        token.status = status;
      }

      await writeStore(store);

      res.json({ token });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
