import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../db.js";
import { requireRoles, requireAdmin, checkPermission } from "../roles.js";

const router = Router();

function toLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getRbacPools(store) {
  if (!Array.isArray(store.rbacPools)) {
    store.rbacPools = [];
  }
  return store.rbacPools;
}

/**
 * Create a new fundraising pool.
 */
router.post(
  "/",
  requireRoles("admin", "srl"),
  checkPermission("pools", "create"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const pools = getRbacPools(store);

      const {
        propertyId,
        tokenId,
        title,
        description,
        fundingGoal,
        investorAllocation = 60,
        maintenanceAllocation = 20,
        insuranceAllocation = 10,
        platformFeeAllocation = 10,
        targetFundingEndDate,
      } = req.body;

      if (!propertyId || !tokenId || !title || fundingGoal === undefined) {
        return res.status(400).json({
          error: "Missing required fields: propertyId, tokenId, title, fundingGoal",
        });
      }

      const property = store.properties?.find((item) => item.id === propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const propertyOwnerWallet = toLower(property.srlWalletAddress || property.createdBy);
      const isPropertyOwner = propertyOwnerWallet === toLower(wallet);

      if (!isAdmin && !isPropertyOwner) {
        return res.status(403).json({
          error: "Only property owner or admin can create pool for this property",
          propertyOwner: propertyOwnerWallet,
        });
      }

      const token = store.assetTokens?.find((item) => item.id === tokenId);
      if (!token) {
        return res.status(404).json({ error: "Token not found" });
      }

      if (token.propertyId !== propertyId) {
        return res.status(400).json({
          error: "Token is for a different property",
          tokenProperty: token.propertyId,
          requestedProperty: propertyId,
        });
      }

      const existingPool = pools.find(
        (item) => item.propertyId === propertyId && item.status !== "archived"
      );
      if (existingPool) {
        return res.status(409).json({
          error: "Pool already exists for this property",
          existingPoolId: existingPool.id,
        });
      }

      const investorPct = toNumber(investorAllocation);
      const maintenancePct = toNumber(maintenanceAllocation);
      const insurancePct = toNumber(insuranceAllocation);
      const platformPct = toNumber(platformFeeAllocation);

      const totalAllocation = investorPct + maintenancePct + insurancePct + platformPct;
      if (totalAllocation !== 100) {
        return res.status(400).json({
          error: "All allocations must sum to 100%",
          total: totalAllocation,
          allocations: {
            investor: investorPct,
            maintenance: maintenancePct,
            insurance: insurancePct,
            platformFee: platformPct,
          },
        });
      }

      const now = new Date().toISOString();
      const pool = {
        id: randomUUID(),
        propertyId,
        tokenId,
        title,
        description: description || "",
        fundingGoal: String(fundingGoal),
        fundingRaised: "0",
        investorAllocation: investorPct,
        maintenanceAllocation: maintenancePct,
        insuranceAllocation: insurancePct,
        platformFeeAllocation: platformPct,
        phase: "phase1_fundraising",
        status: "active",
        createdBy: wallet,
        createdAt: now,
        updatedAt: now,
        targetFundingEndDate: targetFundingEndDate || null,
        acquisitionDocumentId: null,
        installationDocumentId: null,
        metadata: {
          investorCount: 0,
          lastUpdateBy: wallet,
        },
      };

      pools.push(pool);
      await writeStore(store);

      res.status(201).json({ pool });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get all RBAC fundraising pools.
 */
router.get("/", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { propertyId, phase, status } = req.query;

    let pools = [...getRbacPools(store)];

    if (propertyId) {
      pools = pools.filter((item) => item.propertyId === propertyId);
    }

    if (phase) {
      pools = pools.filter((item) => item.phase === phase);
    }

    if (status) {
      pools = pools.filter((item) => item.status === status);
    }

    res.json({
      pools,
      total: pools.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get specific pool details with linked property and token info.
 */
router.get("/:poolId", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { poolId } = req.params;

    const pool = getRbacPools(store).find((item) => item.id === poolId);
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" });
    }

    const property = store.properties?.find((item) => item.id === pool.propertyId) || null;
    const token = store.assetTokens?.find((item) => item.id === pool.tokenId) || null;

    const contributions = (store.contributions || []).filter((item) => item.poolId === poolId);
    const allocations = (store.tokenAllocations || []).filter(
      (item) => item.tokenId === pool.tokenId
    );

    const goal = toNumber(pool.fundingGoal);
    const raised = toNumber(pool.fundingRaised);

    res.json({
      pool,
      property,
      token,
      contributions,
      allocations,
      stats: {
        investorCount: contributions.length,
        totalAllocations: allocations.length,
        fundingProgress: goal > 0 ? raised / goal : 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update pool details.
 */
router.put(
  "/:poolId",
  requireRoles("admin", "srl"),
  checkPermission("pools", "update"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { poolId } = req.params;
      const { title, description, fundingGoal, targetFundingEndDate, status } = req.body;

      const pool = getRbacPools(store).find((item) => item.id === poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const isCreator = toLower(pool.createdBy) === toLower(wallet);

      if (!isCreator && !isAdmin) {
        return res.status(403).json({
          error: "Only the creator or admin can update this pool",
          createdBy: pool.createdBy,
        });
      }

      if (title !== undefined) pool.title = title;
      if (description !== undefined) pool.description = description;
      if (fundingGoal !== undefined) pool.fundingGoal = String(fundingGoal);
      if (targetFundingEndDate !== undefined) pool.targetFundingEndDate = targetFundingEndDate;
      if (status !== undefined && ["active", "paused", "archived"].includes(status)) {
        pool.status = status;
      }

      pool.updatedAt = new Date().toISOString();
      pool.metadata = {
        ...(pool.metadata || {}),
        lastUpdateBy: wallet,
      };

      await writeStore(store);

      res.json({ pool });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Transition pool to next phase.
 */
router.post(
  "/:poolId/transition-phase",
  requireAdmin,
  checkPermission("pools", "manage"),
  async (req, res, next) => {
    try {
      const store = req.store || (await readStore());
      const { poolId } = req.params;
      const { documentProof } = req.body;

      const pool = getRbacPools(store).find((item) => item.id === poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const goal = toNumber(pool.fundingGoal);
      const raised = toNumber(pool.fundingRaised);

      let newPhase = null;

      if (pool.phase === "phase1_fundraising") {
        if (raised < goal) {
          return res.status(400).json({
            error: "Funding goal not met. Cannot transition to funded phase.",
            fundingRaised: pool.fundingRaised,
            fundingGoal: pool.fundingGoal,
          });
        }
        newPhase = "phase1_funded";
        pool.acquisitionDocumentId = documentProof?.id || null;
      } else if (pool.phase === "phase1_funded") {
        newPhase = "phase2_operational";
        pool.installationDocumentId = documentProof?.id || null;
      } else {
        return res.status(400).json({
          error: "Cannot transition from current phase",
          currentPhase: pool.phase,
        });
      }

      pool.phase = newPhase;
      pool.updatedAt = new Date().toISOString();

      await writeStore(store);

      res.json({
        pool,
        message: `Pool transitioned to ${newPhase}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get pool funding progress and investor breakdown.
 */
router.get("/:poolId/stats", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { poolId } = req.params;

    const pool = getRbacPools(store).find((item) => item.id === poolId);
    if (!pool) {
      return res.status(404).json({ error: "Pool not found" });
    }

    const contributions = (store.contributions || []).filter((item) => item.poolId === poolId);

    const goal = toNumber(pool.fundingGoal);
    const raised = toNumber(pool.fundingRaised);
    const fundingProgress = goal > 0 ? raised / goal : 0;

    const distribution = {
      investors: raised * (pool.investorAllocation / 100),
      maintenance: raised * (pool.maintenanceAllocation / 100),
      insurance: raised * (pool.insuranceAllocation / 100),
      platformFee: raised * (pool.platformFeeAllocation / 100),
    };

    const averageContribution =
      contributions.length > 0
        ? (
            contributions.reduce(
              (sum, item) => sum + toNumber(item.amount ?? item.tokenAmount),
              0
            ) / contributions.length
          ).toFixed(2)
        : "0.00";

    res.json({
      poolId,
      phase: pool.phase,
      fundingGoal: pool.fundingGoal,
      fundingRaised: pool.fundingRaised,
      fundingProgress: fundingProgress.toFixed(2),
      fundingPercentage: (fundingProgress * 100).toFixed(1),
      investorCount: contributions.length,
      averageContribution,
      revenueDistribution: distribution,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
