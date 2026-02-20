import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../db.js";
import { requireRoles, checkPermission } from "../roles.js";

const router = Router();

function toLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getRbacOffers(store) {
  if (!Array.isArray(store.rbacComputeOffers)) {
    store.rbacComputeOffers = [];
  }
  return store.rbacComputeOffers;
}

function getRbacPools(store) {
  return Array.isArray(store.rbacPools) ? store.rbacPools : [];
}

function getRbacRentals(store) {
  if (!Array.isArray(store.rbacRentals)) {
    store.rbacRentals = [];
  }
  return store.rbacRentals;
}

/**
 * Create a compute offer.
 */
router.post(
  "/",
  requireRoles("srl", "admin"),
  checkPermission("compute_offers", "create"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const offers = getRbacOffers(store);

      const {
        hardwareSpecId,
        poolId,
        pricePerUnit,
        timeUnit,
        maxUnitsAvailable,
        description,
        minimumRentalPeriod,
      } = req.body;

      if (!hardwareSpecId || !poolId || !pricePerUnit || !timeUnit || !maxUnitsAvailable) {
        return res.status(400).json({
          error:
            "Missing required fields: hardwareSpecId, poolId, pricePerUnit, timeUnit, maxUnitsAvailable",
        });
      }

      const validTimeUnits = ["hour", "day", "week", "month"];
      if (!validTimeUnits.includes(timeUnit)) {
        return res.status(400).json({
          error: `Invalid timeUnit. Must be one of: ${validTimeUnits.join(", ")}`,
        });
      }

      const hardware = store.hardwareSpecs?.find((item) => item.id === hardwareSpecId);
      if (!hardware) {
        return res.status(404).json({ error: "Hardware specification not found" });
      }

      const pool = getRbacPools(store).find((item) => item.id === poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const property = store.properties?.find((item) => item.id === pool.propertyId);
      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const propertyOwnerWallet = toLower(property?.srlWalletAddress || property?.createdBy);
      const isPropertyOwner = propertyOwnerWallet === toLower(wallet);

      if (!isAdmin && !isPropertyOwner) {
        return res.status(403).json({
          error: "Only property owner or admin can create compute offers",
        });
      }

      const existingOffer = offers.find(
        (item) => item.hardwareSpecId === hardwareSpecId && item.status === "active"
      );
      if (existingOffer) {
        return res.status(409).json({
          error: "Active offer already exists for this hardware",
          existingOfferId: existingOffer.id,
        });
      }

      const now = new Date().toISOString();
      const offer = {
        id: randomUUID(),
        hardwareSpecId,
        poolId,
        createdBy: wallet,
        pricePerUnit: String(pricePerUnit),
        timeUnit,
        maxUnitsAvailable: toNumber(maxUnitsAvailable),
        unitsAvailable: toNumber(maxUnitsAvailable),
        description: description || "",
        minimumRentalPeriod: toNumber(minimumRentalPeriod || 1),
        createdAt: now,
        updatedAt: now,
        status: "active",
        stats: {
          totalRentals: 0,
          totalRevenue: "0",
          averageRating: 0,
        },
      };

      offers.push(offer);
      await writeStore(store);

      res.status(201).json({ offer });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get all compute offers.
 */
router.get("/", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { poolId, hardwareType, maxPrice, status } = req.query;

    let offers = [...getRbacOffers(store)];

    if (poolId) {
      offers = offers.filter((item) => item.poolId === poolId);
    }

    if (hardwareType) {
      const hardwareIds = (store.hardwareSpecs || [])
        .filter((item) => item.type === hardwareType)
        .map((item) => item.id);
      offers = offers.filter((item) => hardwareIds.includes(item.hardwareSpecId));
    }

    if (maxPrice) {
      offers = offers.filter((item) => toNumber(item.pricePerUnit) <= toNumber(maxPrice));
    }

    if (status) {
      offers = offers.filter((item) => item.status === status);
    }

    res.json({
      offers,
      total: offers.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get rental marketplace statistics.
 */
router.get("/stats/marketplace", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());

    const offers = getRbacOffers(store);
    const rentals = getRbacRentals(store);

    const activeOffers = offers.filter((item) => item.status === "active");
    const activeRentals = rentals.filter((item) => item.status === "active");

    const totalRevenue = offers.reduce(
      (sum, item) => sum + toNumber(item?.stats?.totalRevenue || 0),
      0
    );

    res.json({
      marketplace: {
        totalOffers: offers.length,
        activeOffers: activeOffers.length,
        totalRentals: rentals.length,
        activeRentals: activeRentals.length,
        totalRevenue: totalRevenue.toFixed(2),
        averagePricePerOffer:
          offers.length > 0
            ? (offers.reduce((sum, item) => sum + toNumber(item.pricePerUnit), 0) / offers.length).toFixed(2)
            : "0.00",
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get specific compute offer with details.
 */
router.get("/:offerId", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { offerId } = req.params;

    const offer = getRbacOffers(store).find((item) => item.id === offerId);
    if (!offer) {
      return res.status(404).json({ error: "Compute offer not found" });
    }

    const hardware = store.hardwareSpecs?.find((item) => item.id === offer.hardwareSpecId) || null;
    const pool = getRbacPools(store).find((item) => item.id === offer.poolId) || null;
    const property = pool
      ? store.properties?.find((item) => item.id === pool.propertyId) || null
      : null;

    const activeRentals = getRbacRentals(store).filter(
      (item) => item.offerId === offerId && item.status === "active"
    );

    res.json({
      offer,
      hardware,
      pool,
      property,
      activeRentals: activeRentals.length,
      totalRentals: offer?.stats?.totalRentals || 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create a rental (compute user renting from an offer).
 */
router.post("/:offerId/rent", async (req, res, next) => {
  try {
    const wallet = req.wallet;
    if (!wallet) {
      return res.status(400).json({ error: "Wallet address required" });
    }

    const store = req.store || (await readStore());
    const { offerId } = req.params;
    const { units, rentalPeriod, totalPrice } = req.body;

    if (!units || !rentalPeriod || !totalPrice) {
      return res.status(400).json({
        error: "Missing required fields: units, rentalPeriod, totalPrice",
      });
    }

    const offer = getRbacOffers(store).find((item) => item.id === offerId);
    if (!offer) {
      return res.status(404).json({ error: "Compute offer not found" });
    }

    if (offer.status !== "active") {
      return res.status(400).json({
        error: "This offer is not currently available for rental",
        status: offer.status,
      });
    }

    const unitsNeeded = toNumber(units);
    if (unitsNeeded > offer.unitsAvailable) {
      return res.status(400).json({
        error: "Not enough units available",
        requested: units,
        available: offer.unitsAvailable,
      });
    }

    if (toNumber(rentalPeriod) < offer.minimumRentalPeriod) {
      return res.status(400).json({
        error: "Rental period below minimum",
        minimum: offer.minimumRentalPeriod,
        requested: rentalPeriod,
      });
    }

    const calculatedPrice = (
      unitsNeeded * toNumber(rentalPeriod) * toNumber(offer.pricePerUnit)
    ).toFixed(2);

    if (Math.abs(toNumber(totalPrice) - toNumber(calculatedPrice)) > 0.01) {
      return res.status(400).json({
        error: "Price mismatch",
        expected: calculatedPrice,
        provided: totalPrice,
      });
    }

    const now = new Date().toISOString();
    const rental = {
      id: randomUUID(),
      offerId,
      renterWallet: wallet,
      units: unitsNeeded,
      rentalPeriod: toNumber(rentalPeriod),
      timeUnit: offer.timeUnit,
      totalPrice: String(totalPrice),
      pricePerUnit: offer.pricePerUnit,
      startedAt: now,
      endsAt: null,
      status: "active",
      createdAt: now,
    };

    const rentals = getRbacRentals(store);
    rentals.push(rental);

    offer.unitsAvailable -= unitsNeeded;
    offer.stats = offer.stats || {
      totalRentals: 0,
      totalRevenue: "0",
      averageRating: 0,
    };
    offer.stats.totalRentals += 1;
    offer.stats.totalRevenue = (
      toNumber(offer.stats.totalRevenue) + toNumber(totalPrice)
    ).toString();

    await writeStore(store);

    res.status(201).json({ rental });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all rentals for a specific offer.
 */
router.get("/:offerId/rentals", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { offerId } = req.params;
    const { status } = req.query;

    const offer = getRbacOffers(store).find((item) => item.id === offerId);
    if (!offer) {
      return res.status(404).json({ error: "Compute offer not found" });
    }

    let rentals = getRbacRentals(store).filter((item) => item.offerId === offerId);

    if (status) {
      rentals = rentals.filter((item) => item.status === status);
    }

    res.json({
      offerId,
      rentals,
      total: rentals.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update compute offer.
 */
router.put(
  "/:offerId",
  requireRoles("srl", "admin"),
  checkPermission("compute_offers", "update"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { offerId } = req.params;
      const { pricePerUnit, description, status } = req.body;

      const offer = getRbacOffers(store).find((item) => item.id === offerId);
      if (!offer) {
        return res.status(404).json({ error: "Compute offer not found" });
      }

      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const isCreator = toLower(offer.createdBy) === toLower(wallet);

      if (!isCreator && !isAdmin) {
        return res.status(403).json({
          error: "Only the creator or admin can update this offer",
          createdBy: offer.createdBy,
        });
      }

      if (pricePerUnit !== undefined) offer.pricePerUnit = String(pricePerUnit);
      if (description !== undefined) offer.description = description;
      if (status !== undefined && ["active", "paused", "archived"].includes(status)) {
        offer.status = status;
      }

      offer.updatedAt = new Date().toISOString();

      await writeStore(store);

      res.json({ offer });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
