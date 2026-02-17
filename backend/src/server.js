import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ADMIN_WALLET, CORS_ORIGIN, MOCK_IOTA, PORT } from "./config.js";
import {
  readStore,
  writeStore,
  getSiteOrThrow,
  getPoolOrThrow,
  getWalletBalance,
  creditWallet,
  debitWallet,
} from "./db.js";
import { sha256Hex } from "./hash.js";
import {
  createNotarizationOnIota,
  getBackendSignerAddress,
} from "./iotaClient.js";

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

function toLowerAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function getRequestWallet(req) {
  return toLowerAddress(req.headers["x-wallet-address"] || req.body?.walletAddress);
}

function requireAdmin(req) {
  if (!ADMIN_WALLET) {
    const error = new Error("ADMIN_WALLET is not configured on backend");
    error.status = 500;
    throw error;
  }

  const wallet = getRequestWallet(req);
  if (!wallet) {
    const error = new Error("walletAddress is required");
    error.status = 400;
    throw error;
  }

  if (wallet !== ADMIN_WALLET) {
    const error = new Error("Forbidden: wallet is not admin");
    error.status = 403;
    throw error;
  }

  return wallet;
}

function buildPoolProgress(pool) {
  const percentage =
    pool.hardCapTokens > 0
      ? Math.min(100, Math.floor((pool.raisedTokens / pool.hardCapTokens) * 100))
      : 0;

  return {
    ...pool,
    percentage,
    remainingTokens: Math.max(pool.hardCapTokens - pool.raisedTokens, 0),
  };
}

function getPoolProofs(store, poolId) {
  return store.proofs.filter((proof) => proof.poolId === poolId);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "serverfarmchain-backend",
    timestamp: new Date().toISOString(),
    iotaMode: MOCK_IOTA ? "mock" : "live",
    adminWallet: ADMIN_WALLET || null,
    iotaBackendSigner: getBackendSignerAddress(),
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    adminWallet: ADMIN_WALLET || null,
  });
});

app.get("/api/sites", async (_req, res, next) => {
  try {
    const store = await readStore();
    res.json({ sites: store.sites });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pools", async (_req, res, next) => {
  try {
    const store = await readStore();
    const pools = store.pools.map((pool) => {
      const site = store.sites.find((item) => item.id === pool.siteId) || null;
      const proofs = getPoolProofs(store, pool.id);

      return {
        ...buildPoolProgress(pool),
        site,
        docsCount: proofs.length,
      };
    });

    res.json({ pools });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pools/:poolId", async (req, res, next) => {
  try {
    const store = await readStore();
    const pool = getPoolOrThrow(store, req.params.poolId);
    const site = getSiteOrThrow(store, pool.siteId);

    const contributions = store.contributions
      .filter((item) => item.poolId === pool.id)
      .sort((a, b) => b.timestampMs - a.timestampMs);

    const proofs = getPoolProofs(store, pool.id)
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .map((proof) => ({
        ...proof,
        verifyEndpoint: `/api/proofs/${proof.id}`,
      }));

    res.json({
      pool: buildPoolProgress(pool),
      site,
      contributions,
      proofs,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/pools", async (req, res, next) => {
  try {
    requireAdmin(req);

    const {
      siteId,
      title,
      description,
      location,
      landValueTokens,
      surplusTokens,
      documents,
      tokenSymbol = "SFC",
    } = req.body;

    if (!siteId || !title || !location) {
      return res.status(400).json({ error: "siteId, title and location are required" });
    }

    const landValue = Number(landValueTokens || 0);
    const surplus = Number(surplusTokens || 0);

    if (landValue <= 0) {
      return res.status(400).json({ error: "landValueTokens must be > 0" });
    }
    if (surplus < 0) {
      return res.status(400).json({ error: "surplusTokens must be >= 0" });
    }

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "documents array is required" });
    }

    const store = await readStore();
    const site = getSiteOrThrow(store, siteId);

    const poolId = `pool_${randomUUID()}`;
    const hardCapTokens = landValue + surplus;

    const pool = {
      id: poolId,
      siteId,
      title,
      description: description || "",
      location,
      status: "open",
      createdAtMs: Date.now(),
      landValueTokens: landValue,
      surplusTokens: surplus,
      hardCapTokens,
      raisedTokens: 0,
      tokenSymbol,
      acquisitionProofId: null,
      computeOfferId: null,
    };

    store.pools.push(pool);

    for (const doc of documents) {
      if (!doc.name || !doc.docType || !doc.driveUrl) {
        throw new Error("Each document requires name, docType, driveUrl");
      }

      const docHash =
        doc.docHashSha256 && typeof doc.docHashSha256 === "string"
          ? doc.docHashSha256
          : sha256Hex(Buffer.from(`${doc.name}|${doc.docType}|${doc.driveUrl}`, "utf8"));

      const iotaResult = await createNotarizationOnIota({
        siteId: site.id,
        siteObjectId: site.iotaSiteObjectId || null,
        docType: doc.docType,
        issuer: ADMIN_WALLET,
        fileHash: docHash,
        fileName: doc.name,
        timestampMs: Date.now(),
      });

      store.proofs.push({
        id: `proof_${randomUUID()}`,
        poolId,
        siteId: site.id,
        name: doc.name,
        docType: doc.docType,
        driveUrl: doc.driveUrl,
        docHashSha256: docHash,
        issuer: ADMIN_WALLET,
        timestampMs: iotaResult.timestampMs,
        iotaObjectId: iotaResult.objectId,
        iotaTxDigest: iotaResult.txDigest,
        chainMode: iotaResult.mode,
      });
    }

    await writeStore(store);

    res.status(201).json({ pool: buildPoolProgress(pool) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/pools/:poolId/contribute", async (req, res, next) => {
  try {
    const walletAddress = getRequestWallet(req);
    const { tokenAmount } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const amount = Number(tokenAmount || 0);
    if (amount <= 0) {
      return res.status(400).json({ error: "tokenAmount must be > 0" });
    }

    const store = await readStore();
    const pool = getPoolOrThrow(store, req.params.poolId);

    if (pool.status !== "open") {
      return res.status(400).json({ error: "Pool is not open" });
    }

    const remaining = pool.hardCapTokens - pool.raisedTokens;
    if (amount > remaining) {
      return res.status(400).json({
        error: "Amount exceeds remaining pool capacity",
        remaining,
      });
    }

    pool.raisedTokens += amount;
    if (pool.raisedTokens >= pool.hardCapTokens) {
      pool.status = "funded";
      pool.fundedAtMs = Date.now();
    }

    const contribution = {
      id: `contrib_${randomUUID()}`,
      poolId: pool.id,
      walletAddress,
      tokenAmount: amount,
      timestampMs: Date.now(),
    };

    store.contributions.push(contribution);
    creditWallet(store, walletAddress, amount);

    await writeStore(store);

    res.status(201).json({
      contribution,
      pool: buildPoolProgress(pool),
      walletBalance: getWalletBalance(store, walletAddress),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/pools/:poolId/acquisition-doc", async (req, res, next) => {
  try {
    requireAdmin(req);

    const { name, driveUrl, docHashSha256 } = req.body;
    if (!name || !driveUrl) {
      return res.status(400).json({ error: "name and driveUrl are required" });
    }

    const store = await readStore();
    const pool = getPoolOrThrow(store, req.params.poolId);
    const site = getSiteOrThrow(store, pool.siteId);

    if (pool.status !== "funded" && pool.status !== "acquired" && pool.status !== "operational") {
      return res.status(400).json({ error: "Pool must be funded before adding acquisition deed" });
    }

    const hash =
      docHashSha256 && typeof docHashSha256 === "string"
        ? docHashSha256
        : sha256Hex(Buffer.from(`${name}|AcquisitionDeed|${driveUrl}`, "utf8"));

    const iotaResult = await createNotarizationOnIota({
      siteId: site.id,
      siteObjectId: site.iotaSiteObjectId || null,
      docType: "Acquisition Deed",
      issuer: ADMIN_WALLET,
      fileHash: hash,
      fileName: name,
      timestampMs: Date.now(),
    });

    const proof = {
      id: `proof_${randomUUID()}`,
      poolId: pool.id,
      siteId: site.id,
      name,
      docType: "Acquisition Deed",
      driveUrl,
      docHashSha256: hash,
      issuer: ADMIN_WALLET,
      timestampMs: iotaResult.timestampMs,
      iotaObjectId: iotaResult.objectId,
      iotaTxDigest: iotaResult.txDigest,
      chainMode: iotaResult.mode,
    };

    store.proofs.push(proof);
    pool.acquisitionProofId = proof.id;
    if (pool.status === "funded") {
      pool.status = "acquired";
      pool.acquiredAtMs = Date.now();
    }

    await writeStore(store);

    res.status(201).json({
      pool: buildPoolProgress(pool),
      proof,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/pools/:poolId/compute-offer", async (req, res, next) => {
  try {
    requireAdmin(req);

    const {
      region,
      hardware,
      totalUnits,
      tokensPerUnitHour,
      documents,
    } = req.body;

    if (!region || !hardware) {
      return res.status(400).json({ error: "region and hardware are required" });
    }

    const units = Number(totalUnits || 0);
    const price = Number(tokensPerUnitHour || 0);
    if (units <= 0 || price <= 0) {
      return res
        .status(400)
        .json({ error: "totalUnits and tokensPerUnitHour must be > 0" });
    }

    const store = await readStore();
    const pool = getPoolOrThrow(store, req.params.poolId);
    const site = getSiteOrThrow(store, pool.siteId);

    if (pool.status !== "acquired" && pool.status !== "operational") {
      return res.status(400).json({
        error: "Pool must be acquired before enabling compute offer",
      });
    }

    const existing = store.computeOffers.find((item) => item.poolId === pool.id);
    const offerId = existing?.id || `offer_${randomUUID()}`;

    const offer = {
      id: offerId,
      poolId: pool.id,
      siteId: site.id,
      region,
      hardware,
      totalUnits: units,
      availableUnits: existing ? Math.min(existing.availableUnits, units) : units,
      tokensPerUnitHour: price,
      docs: Array.isArray(documents) ? documents : [],
      status: "active",
      updatedAtMs: Date.now(),
    };

    if (existing) {
      const index = store.computeOffers.findIndex((item) => item.id === existing.id);
      store.computeOffers[index] = offer;
    } else {
      store.computeOffers.push(offer);
    }

    pool.computeOfferId = offer.id;
    pool.status = "operational";
    pool.operationalAtMs = Date.now();

    await writeStore(store);

    res.status(201).json({
      pool: buildPoolProgress(pool),
      computeOffer: offer,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/compute/offers", async (req, res, next) => {
  try {
    const location = typeof req.query.location === "string" ? req.query.location : "";
    const store = await readStore();

    const offers = store.computeOffers
      .filter((offer) => offer.status === "active")
      .map((offer) => {
        const pool = store.pools.find((item) => item.id === offer.poolId) || null;
        const site = store.sites.find((item) => item.id === offer.siteId) || null;
        const proofs = getPoolProofs(store, offer.poolId);

        return {
          ...offer,
          pool: pool ? buildPoolProgress(pool) : null,
          site,
          docs: [...offer.docs, ...proofs],
        };
      })
      .filter((offer) =>
        location
          ? offer.region.toLowerCase().includes(location.toLowerCase()) ||
            offer.site?.approxLocation?.toLowerCase().includes(location.toLowerCase())
          : true
      );

    res.json({ offers });
  } catch (error) {
    next(error);
  }
});

app.post("/api/compute/rent", async (req, res, next) => {
  try {
    const walletAddress = getRequestWallet(req);
    const { offerId, units, hours } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }
    if (!offerId) {
      return res.status(400).json({ error: "offerId is required" });
    }

    const unitsNum = Number(units || 0);
    const hoursNum = Number(hours || 0);
    if (unitsNum <= 0 || hoursNum <= 0) {
      return res.status(400).json({ error: "units and hours must be > 0" });
    }

    const store = await readStore();
    const offer = store.computeOffers.find((item) => item.id === offerId);
    if (!offer) {
      return res.status(404).json({ error: "Compute offer not found" });
    }

    if (offer.availableUnits < unitsNum) {
      return res.status(400).json({
        error: "Requested units exceed available capacity",
        availableUnits: offer.availableUnits,
      });
    }

    const totalCost = unitsNum * hoursNum * Number(offer.tokensPerUnitHour);

    debitWallet(store, walletAddress, totalCost);
    offer.availableUnits -= unitsNum;

    const rental = {
      id: `rent_${randomUUID()}`,
      offerId: offer.id,
      poolId: offer.poolId,
      siteId: offer.siteId,
      walletAddress,
      units: unitsNum,
      hours: hoursNum,
      totalCostTokens: totalCost,
      status: "active",
      timestampMs: Date.now(),
    };

    store.rentals.push(rental);
    await writeStore(store);

    res.status(201).json({
      rental,
      walletBalance: getWalletBalance(store, walletAddress),
      availableUnits: offer.availableUnits,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/wallets/:walletAddress/summary", async (req, res, next) => {
  try {
    const walletAddress = toLowerAddress(req.params.walletAddress);
    const store = await readStore();

    const contributions = store.contributions.filter(
      (item) => item.walletAddress === walletAddress
    );
    const rentals = store.rentals.filter(
      (item) => item.walletAddress === walletAddress
    );

    res.json({
      walletAddress,
      tokenBalance: getWalletBalance(store, walletAddress),
      contributions,
      rentals,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/proofs/:proofId", async (req, res, next) => {
  try {
    const store = await readStore();
    const proof = store.proofs.find((item) => item.id === req.params.proofId);
    if (!proof) {
      return res.status(404).json({ error: "Proof not found" });
    }
    res.json({ proof });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || "Unexpected error",
  });
});

app.listen(PORT, () => {
  console.log(`serverfarmchain backend listening on http://localhost:${PORT}`);
});
