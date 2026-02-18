import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  ADMIN_WALLET,
  REQUIRE_ONCHAIN_CONTRIBUTION,
  CONTRIBUTION_PRICE_NANOS,
  CONTRIBUTION_RECIPIENT_WALLET,
} from "../config.js";
import {
  readStore,
  writeStore,
  getSiteOrThrow,
  getPoolOrThrow,
  getWalletBalance,
  getWalletLockedBalance,
  creditWallet,
  creditLockedWallet,
  debitWallet,
  debitLockedWallet,
  moveLockedToAvailableWallet,
} from "../db.js";
import { sha256Hex } from "../hash.js";
import {
  createNotarizationOnIota,
  verifyIotaPaymentTx,
  sendIotaFromBackend,
} from "../iotaClient.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POOL_FUNDING_DAYS = 30;

function toLowerAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRequestWallet(req) {
  return toLowerAddress(req.headers["x-wallet-address"] || req.body?.walletAddress);
}

function requireAdminWallet(req) {
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
  const now = Date.now();
  const hardCapTokens = toNumber(pool.hardCapTokens);
  const raisedTokens = toNumber(pool.raisedTokens);
  const percentage =
    hardCapTokens > 0
      ? Math.min(100, Math.floor((raisedTokens / hardCapTokens) * 100))
      : 0;
  const derivedStatus = derivePoolStatus(pool, now);
  const fundingDeadlineMs = toNumber(pool.fundingDeadlineMs) || null;
  const isFundingExpired =
    fundingDeadlineMs !== null &&
    derivedStatus !== "funded" &&
    derivedStatus !== "acquired" &&
    derivedStatus !== "operational" &&
    derivedStatus !== "closed" &&
    now > fundingDeadlineMs;
  const fundingRemainingMs =
    fundingDeadlineMs === null ? null : Math.max(fundingDeadlineMs - now, 0);

  return {
    ...pool,
    status: derivedStatus,
    hardCapTokens,
    raisedTokens,
    percentage,
    remainingTokens: Math.max(hardCapTokens - raisedTokens, 0),
    fundingDeadlineMs,
    fundingRemainingMs,
    isFundingExpired,
    isRefundOpen: derivedStatus === "failed",
  };
}

function derivePoolStatus(pool, now = Date.now()) {
  const hardCapTokens = toNumber(pool.hardCapTokens);
  const raisedTokens = toNumber(pool.raisedTokens);
  const fundingDeadlineMs = toNumber(pool.fundingDeadlineMs);

  if (
    pool.status === "open" &&
    fundingDeadlineMs > 0 &&
    raisedTokens < hardCapTokens &&
    now > fundingDeadlineMs
  ) {
    return "failed";
  }

  return pool.status;
}

function syncPoolFundingState(pool, now = Date.now()) {
  const nextStatus = derivePoolStatus(pool, now);
  if (nextStatus !== pool.status) {
    pool.status = nextStatus;
    if (nextStatus === "failed" && !pool.failedAtMs) {
      pool.failedAtMs = now;
    }
    return true;
  }
  return false;
}

function releaseFundedPoolTokens(store, pool, timestampMs = Date.now()) {
  if (!["funded", "acquired", "operational", "closed"].includes(pool.status)) {
    return 0;
  }

  let releasedTokens = 0;
  for (const contribution of store.contributions) {
    if (contribution.poolId !== pool.id) continue;
    if (contribution.refundedAtMs || contribution.tokensReleasedAtMs) continue;
    if (contribution.tokenSettlementMode !== "locked") continue;

    const amount = toNumber(contribution.tokenAmount);
    if (amount <= 0) {
      contribution.tokensReleasedAtMs = timestampMs;
      continue;
    }

    moveLockedToAvailableWallet(store, contribution.walletAddress, amount);
    contribution.tokensReleasedAtMs = timestampMs;
    releasedTokens += amount;
  }

  return releasedTokens;
}

function getContributionPaymentNanos(contribution) {
  if (typeof contribution.paymentAmountNanoIota === "string") {
    try {
      const parsed = BigInt(contribution.paymentAmountNanoIota);
      if (parsed > 0n) {
        return parsed;
      }
    } catch {
      // fallback below
    }
  }

  const amountTokens = BigInt(Math.max(0, Math.trunc(toNumber(contribution.tokenAmount))));
  return amountTokens * CONTRIBUTION_PRICE_NANOS;
}

function getPoolProofs(store, poolId) {
  return store.proofs.filter((proof) => proof.poolId === poolId);
}

function toProofSummary(proof) {
  return {
    id: proof.id,
    name: proof.name,
    docType: proof.docType,
    iotaTxDigest: proof.iotaTxDigest || null,
    chainMode: proof.chainMode || null,
    timestampMs: proof.timestampMs || null,
  };
}

async function getStore(req) {
  return req.store || (await readStore());
}

router.get("/sites", async (req, res, next) => {
  try {
    const store = await getStore(req);
    res.json({ sites: store.sites });
  } catch (error) {
    next(error);
  }
});

router.get("/pools", async (req, res, next) => {
  try {
    const store = await getStore(req);
    const pools = store.pools
      .filter((pool) => typeof pool.siteId === "string")
      .map((pool) => {
        const site = store.sites.find((item) => item.id === pool.siteId) || null;
        const proofs = getPoolProofs(store, pool.id)
          .sort((a, b) => b.timestampMs - a.timestampMs)
          .map(toProofSummary);

        return {
          ...buildPoolProgress(pool),
          site,
          docsCount: proofs.length,
          proofs,
        };
      });

    res.json({ pools });
  } catch (error) {
    next(error);
  }
});

router.get("/pools/:poolId", async (req, res, next) => {
  try {
    const store = await getStore(req);
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

router.post("/admin/pools", async (req, res, next) => {
  try {
    requireAdminWallet(req);

    const {
      siteId,
      title,
      description,
      location,
      landValueTokens,
      surplusTokens,
      documents,
      tokenSymbol = "SFC",
      fundingDurationDays,
      fundingDeadlineMs,
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

    const store = await getStore(req);
    const site = getSiteOrThrow(store, siteId);

    const poolId = `pool_${randomUUID()}`;
    const hardCapTokens = landValue + surplus;
    const now = Date.now();
    const durationDays = Number(fundingDurationDays || DEFAULT_POOL_FUNDING_DAYS);
    const deadlineFromDuration = now + Math.max(1, Math.floor(durationDays)) * DAY_MS;
    const deadlineCandidate = Number(fundingDeadlineMs || deadlineFromDuration);
    if (!Number.isFinite(deadlineCandidate) || deadlineCandidate <= now) {
      return res.status(400).json({
        error: "fundingDeadlineMs (or fundingDurationDays) must define a future deadline",
      });
    }

    const pool = {
      id: poolId,
      siteId,
      title,
      description: description || "",
      location,
      status: "open",
      createdAtMs: now,
      fundingStartMs: now,
      fundingDeadlineMs: deadlineCandidate,
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

router.post("/pools/:poolId/contribute", async (req, res, next) => {
  try {
    const walletAddress = getRequestWallet(req);
    const { tokenAmount, paymentTxDigest } = req.body;
    const normalizedPaymentDigest =
      typeof paymentTxDigest === "string" ? paymentTxDigest.trim() : "";

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const amount = Number(tokenAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "tokenAmount must be > 0" });
    }
    if (REQUIRE_ONCHAIN_CONTRIBUTION && !Number.isInteger(amount)) {
      return res.status(400).json({
        error: "tokenAmount must be an integer when on-chain contribution is enabled",
      });
    }

    const store = await getStore(req);
    const pool = getPoolOrThrow(store, req.params.poolId);
    const now = Date.now();
    const statusChangedByDeadline = syncPoolFundingState(pool, now);

    if (pool.status !== "open") {
      if (statusChangedByDeadline) {
        await writeStore(store);
      }
      return res.status(400).json({ error: "Pool is not open" });
    }

    const remaining = pool.hardCapTokens - pool.raisedTokens;
    if (amount > remaining) {
      return res.status(400).json({
        error: "Amount exceeds remaining pool capacity",
        remaining,
      });
    }

    if (
      normalizedPaymentDigest.length > 0 &&
      store.contributions.some((item) => item.paymentTxDigest === normalizedPaymentDigest)
    ) {
      return res.status(409).json({
        error: "paymentTxDigest already used",
      });
    }

    let paymentVerification = null;
    let expectedPaymentAmountNanoIota = null;
    if (REQUIRE_ONCHAIN_CONTRIBUTION) {
      if (!CONTRIBUTION_RECIPIENT_WALLET) {
        const error = new Error(
          "CONTRIBUTION_RECIPIENT_WALLET (or ADMIN_WALLET) must be configured when on-chain contribution is enabled"
        );
        error.status = 500;
        throw error;
      }
      if (walletAddress === CONTRIBUTION_RECIPIENT_WALLET) {
        return res.status(400).json({
          error:
            "Contributor wallet cannot be the same as treasury wallet. Use a dedicated treasury wallet or contribute from a different wallet.",
        });
      }

      if (normalizedPaymentDigest.length === 0) {
        return res.status(400).json({
          error: "paymentTxDigest is required when on-chain contribution is enabled",
        });
      }

      expectedPaymentAmountNanoIota = (
        BigInt(amount) * CONTRIBUTION_PRICE_NANOS
      ).toString();

      paymentVerification = await verifyIotaPaymentTx({
        txDigest: normalizedPaymentDigest,
        expectedFromWallet: walletAddress,
        expectedToWallet: CONTRIBUTION_RECIPIENT_WALLET,
        minimumAmountNanoIota: expectedPaymentAmountNanoIota,
      });
    }

    pool.raisedTokens += amount;
    if (pool.raisedTokens >= pool.hardCapTokens) {
      pool.status = "funded";
      pool.fundedAtMs = now;
    }

    const contribution = {
      id: `contrib_${randomUUID()}`,
      poolId: pool.id,
      walletAddress,
      tokenAmount: amount,
      paymentMode: REQUIRE_ONCHAIN_CONTRIBUTION ? "onchain" : "offchain",
      tokenSettlementMode: "locked",
      timestampMs: now,
    };
    if (paymentVerification) {
      contribution.transactionHash = paymentVerification.txDigest;
      contribution.paymentTxDigest = paymentVerification.txDigest;
      contribution.paymentCoinType = paymentVerification.coinType;
      contribution.paymentAmountNanoIota = paymentVerification.amountNanoIota;
      contribution.expectedPaymentAmountNanoIota = expectedPaymentAmountNanoIota;
      contribution.paymentRecipientWallet = paymentVerification.recipient;
    }

    store.contributions.push(contribution);
    creditLockedWallet(store, walletAddress, amount);
    if (pool.status === "funded") {
      releaseFundedPoolTokens(store, pool, now);
    }

    await writeStore(store);

    res.status(201).json({
      contribution,
      pool: buildPoolProgress(pool),
      walletBalance: getWalletBalance(store, walletAddress),
      lockedWalletBalance: getWalletLockedBalance(store, walletAddress),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/pools/:poolId/refund", async (req, res, next) => {
  try {
    const walletAddress = getRequestWallet(req);
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const store = await getStore(req);
    const pool = getPoolOrThrow(store, req.params.poolId);
    const now = Date.now();
    const statusChangedByDeadline = syncPoolFundingState(pool, now);

    if (pool.status !== "failed") {
      if (statusChangedByDeadline) {
        await writeStore(store);
      }
      return res.status(400).json({
        error: "Refund is available only when pool funding failed after deadline",
        poolStatus: pool.status,
      });
    }

    const refundableContributions = store.contributions.filter(
      (item) =>
        item.poolId === pool.id &&
        item.walletAddress === walletAddress &&
        !item.refundedAtMs &&
        !item.tokensReleasedAtMs
    );

    if (refundableContributions.length === 0) {
      return res.status(404).json({
        error: "No refundable contribution found for this wallet",
      });
    }

    const refundableTokenAmount = refundableContributions.reduce(
      (total, item) => total + toNumber(item.tokenAmount),
      0
    );
    if (refundableTokenAmount <= 0) {
      return res.status(400).json({ error: "Refundable token amount is zero" });
    }

    // First remove/burn claim tokens from the user side.
    let remainingToBurn = refundableTokenAmount;
    const lockedBalance = getWalletLockedBalance(store, walletAddress);
    if (lockedBalance > 0) {
      const burnFromLocked = Math.min(lockedBalance, remainingToBurn);
      debitLockedWallet(store, walletAddress, burnFromLocked);
      remainingToBurn -= burnFromLocked;
    }

    if (remainingToBurn > 0) {
      // Backward-compatibility path for old contributions that were credited directly.
      debitWallet(store, walletAddress, remainingToBurn);
    }

    let refundTxDigest = null;
    let refundedNanoIota = null;
    if (REQUIRE_ONCHAIN_CONTRIBUTION) {
      const totalRefundNano = refundableContributions.reduce(
        (total, item) => total + getContributionPaymentNanos(item),
        0n
      );

      if (totalRefundNano <= 0n) {
        return res.status(400).json({
          error: "Refund amount could not be computed for on-chain contribution mode",
        });
      }

      const refundResult = await sendIotaFromBackend({
        recipientWallet: walletAddress,
        amountNanoIota: totalRefundNano.toString(),
        reason: `pool_${pool.id}_failed_refund`,
      });
      refundTxDigest = refundResult.txDigest;
      refundedNanoIota = refundResult.amountNanoIota;
    }

    const refundedAtMs = Date.now();
    for (const contribution of refundableContributions) {
      contribution.refundedAtMs = refundedAtMs;
      contribution.refundReason = "pool_failed_deadline";
      if (refundTxDigest) {
        contribution.refundTxDigest = refundTxDigest;
        contribution.refundAmountNanoIota = getContributionPaymentNanos(contribution).toString();
      }
    }

    pool.refundedTokens = toNumber(pool.refundedTokens) + refundableTokenAmount;

    await writeStore(store);

    res.status(201).json({
      pool: buildPoolProgress(pool),
      refundedTokenAmount: refundableTokenAmount,
      refundedNanoIota,
      refundTxDigest,
      walletBalance: getWalletBalance(store, walletAddress),
      lockedWalletBalance: getWalletLockedBalance(store, walletAddress),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/pools/:poolId/acquisition-doc", async (req, res, next) => {
  try {
    requireAdminWallet(req);

    const { name, driveUrl, docHashSha256 } = req.body;
    if (!name || !driveUrl) {
      return res.status(400).json({ error: "name and driveUrl are required" });
    }

    const store = await getStore(req);
    const pool = getPoolOrThrow(store, req.params.poolId);
    const site = getSiteOrThrow(store, pool.siteId);
    const statusChangedByDeadline = syncPoolFundingState(pool, Date.now());

    if (pool.status !== "funded" && pool.status !== "acquired" && pool.status !== "operational") {
      if (statusChangedByDeadline) {
        await writeStore(store);
      }
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

router.post("/admin/pools/:poolId/compute-offer", async (req, res, next) => {
  try {
    requireAdminWallet(req);

    const { region, hardware, totalUnits, tokensPerUnitHour, documents } = req.body;

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

    const store = await getStore(req);
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

router.get("/compute/offers", async (req, res, next) => {
  try {
    const location = typeof req.query.location === "string" ? req.query.location : "";
    const store = await getStore(req);

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

router.post("/compute/rent", async (req, res, next) => {
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

    const store = await getStore(req);
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

router.get("/wallets/:walletAddress/summary", async (req, res, next) => {
  try {
    const walletAddress = toLowerAddress(req.params.walletAddress);
    const store = await getStore(req);

    const contributions = store.contributions.filter(
      (item) => item.walletAddress === walletAddress
    );
    const rentals = store.rentals.filter((item) => item.walletAddress === walletAddress);

    res.json({
      walletAddress,
      tokenBalance: getWalletBalance(store, walletAddress),
      lockedTokenBalance: getWalletLockedBalance(store, walletAddress),
      contributions,
      rentals,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/proofs/:proofId", async (req, res, next) => {
  try {
    const store = await getStore(req);
    const proof = store.proofs.find((item) => item.id === req.params.proofId);
    if (!proof) {
      return res.status(404).json({ error: "Proof not found" });
    }
    res.json({ proof });
  } catch (error) {
    next(error);
  }
});

export default router;
