import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  ADMIN_WALLET,
  MOCK_IOTA,
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
  createSitePassportOnIota,
  createBatchNotarizationOnIota,
  getBackendSignerAddress,
  verifyIotaPaymentTx,
  sendIotaFromBackend,
} from "../iotaClient.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_POOL_FUNDING_DAYS = 30;

function toLowerAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextSiteId(store) {
  const existingIds = new Set((store.sites || []).map((site) => String(site.id || "")));
  let index = (store.sites || []).length + 1;
  while (index < 10000) {
    const candidate = `SITE-${String(index).padStart(3, "0")}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
  return `SITE-${randomUUID()}`;
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

function assertLiveSignerMatchesAdmin() {
  if (MOCK_IOTA) {
    return;
  }
  const backendSigner = toLowerAddress(getBackendSignerAddress());
  if (!backendSigner) {
    const error = new Error(
      "IOTA_SIGNER_SECRET_KEY is required for live notarization signer"
    );
    error.status = 500;
    throw error;
  }
  if (backendSigner !== ADMIN_WALLET) {
    const error = new Error(
      `Live notarization signer ${backendSigner} must match ADMIN_WALLET ${ADMIN_WALLET}`
    );
    error.status = 500;
    throw error;
  }
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeSha256Hash(rawHash, fieldName = "docHashSha256") {
  if (typeof rawHash !== "string") {
    throw createHttpError(400, `${fieldName} must be a SHA-256 hex string`);
  }
  const normalized = rawHash.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw createHttpError(
      400,
      `${fieldName} must be a 64-char SHA-256 hex string (optionally prefixed with 0x)`
    );
  }
  return normalized;
}

function buildDocPayload(rawDoc, { defaultDocType = "", autoHashTypeLabel = "" } = {}) {
  const name = typeof rawDoc?.name === "string" ? rawDoc.name.trim() : "";
  const driveUrl = typeof rawDoc?.driveUrl === "string" ? rawDoc.driveUrl.trim() : "";
  const docTypeRaw =
    typeof rawDoc?.docType === "string" ? rawDoc.docType.trim() : defaultDocType;
  const docType = docTypeRaw || defaultDocType;

  if (!name || !driveUrl || !docType) {
    throw createHttpError(400, "Each document requires name, docType and driveUrl");
  }

  const providedHash =
    typeof rawDoc?.docHashSha256 === "string" ? rawDoc.docHashSha256.trim() : "";
  const docHashSha256 = providedHash
    ? normalizeSha256Hash(providedHash)
    : sha256Hex(Buffer.from(`${name}|${autoHashTypeLabel || docType}|${driveUrl}`, "utf8"));

  return {
    name,
    docType,
    driveUrl,
    docHashSha256,
  };
}

function makeProofRecord({
  poolId,
  siteId,
  document,
  adminWallet,
  notarizationResult,
  proofIndex,
}) {
  const batchProof = notarizationResult.proofs[proofIndex] || null;
  return {
    id: `proof_${randomUUID()}`,
    poolId,
    siteId,
    name: document.name,
    docType: document.docType,
    driveUrl: document.driveUrl,
    docHashSha256: document.docHashSha256,
    issuer: adminWallet,
    timestampMs: batchProof?.timestampMs || notarizationResult.timestampMs,
    iotaObjectId: batchProof?.objectId || null,
    iotaTxDigest: notarizationResult.txDigest || null,
    iotaSignedBy: notarizationResult.signedBy || null,
    chainMode: notarizationResult.mode,
    notarizationProvider: notarizationResult.provider || "passport",
    batchIndex: proofIndex,
  };
}

async function notarizePoolDocuments({
  store,
  pool,
  site,
  documents,
  adminWallet,
}) {
  assertLiveSignerMatchesAdmin();
  const notarizationResult = await createBatchNotarizationOnIota({
    siteId: site.id,
    siteObjectId: site.iotaSiteObjectId || null,
    entries: documents.map((doc) => ({
      docType: doc.docType,
      fileHash: doc.docHashSha256,
      fileName: doc.name,
      timestampMs: Date.now(),
    })),
  });

  const proofs = documents.map((document, proofIndex) => {
    const proof = makeProofRecord({
      poolId: pool.id,
      siteId: site.id,
      document,
      adminWallet,
      notarizationResult,
      proofIndex,
    });
    store.proofs.push(proof);
    return proof;
  });

  return { proofs, notarizationResult };
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

function settleExpiredLegacyRentals(store, now = Date.now()) {
  if (!Array.isArray(store.rentals) || store.rentals.length === 0) {
    return false;
  }
  const offers = Array.isArray(store.computeOffers) ? store.computeOffers : [];
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  let changed = false;

  for (const rental of store.rentals) {
    if (!rental || rental.status !== "active") {
      continue;
    }
    const endAtMs = toNumber(rental.endAtMs);
    if (endAtMs <= 0 || now < endAtMs) {
      continue;
    }

    rental.status = "completed";
    rental.completedAtMs = now;

    const offer = offerById.get(rental.offerId);
    if (offer) {
      const units = Math.max(0, Math.trunc(toNumber(rental.units)));
      const totalUnits = Math.max(0, Math.trunc(toNumber(offer.totalUnits)));
      const availableUnits = Math.max(0, Math.trunc(toNumber(offer.availableUnits)));
      offer.availableUnits = Math.min(totalUnits, availableUnits + units);
    }
    changed = true;
  }

  return changed;
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
    iotaSignedBy: proof.iotaSignedBy || null,
    chainMode: proof.chainMode || null,
    notarizationProvider: proof.notarizationProvider || "passport",
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

router.post("/admin/sites", async (req, res, next) => {
  try {
    requireAdminWallet(req);

    const {
      id,
      name,
      siteType,
      areaM2,
      targetKw,
      approxLocation,
      owner,
      computeReady = true,
      status = "seed",
      tags = [],
      mintOnIota = true,
      iotaSiteObjectId,
    } = req.body || {};

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedSiteType = typeof siteType === "string" ? siteType.trim() : "";
    const normalizedLocation =
      typeof approxLocation === "string" ? approxLocation.trim() : "";
    if (!normalizedName || !normalizedSiteType || !normalizedLocation) {
      return res.status(400).json({
        error: "name, siteType and approxLocation are required",
      });
    }

    const area = Math.trunc(toNumber(areaM2));
    const target = Math.trunc(toNumber(targetKw));
    if (area <= 0) {
      return res.status(400).json({ error: "areaM2 must be > 0" });
    }
    if (target < 0) {
      return res.status(400).json({ error: "targetKw must be >= 0" });
    }

    const store = await getStore(req);
    const requestedId =
      typeof id === "string" && id.trim().length > 0
        ? id.trim().toUpperCase()
        : nextSiteId(store);
    if (store.sites.some((site) => site.id === requestedId)) {
      return res.status(409).json({
        error: `Site id ${requestedId} already exists`,
      });
    }

    let normalizedSiteObjectId =
      typeof iotaSiteObjectId === "string" ? iotaSiteObjectId.trim() : "";
    let siteMintResult = null;
    if (!normalizedSiteObjectId) {
      if (mintOnIota === false) {
        return res.status(400).json({
          error: "iotaSiteObjectId is required when mintOnIota=false",
        });
      }

      assertLiveSignerMatchesAdmin();
      siteMintResult = await createSitePassportOnIota({
        siteCode: requestedId,
        siteType: normalizedSiteType,
        areaM2: area,
        targetKw: target,
        approxLocation: normalizedLocation,
      });
      normalizedSiteObjectId = siteMintResult.objectId || "";
    }

    const normalizedTags = Array.isArray(tags)
      ? tags
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];

    const site = {
      id: requestedId,
      name: normalizedName,
      siteType: normalizedSiteType,
      areaM2: area,
      targetKw: target,
      approxLocation: normalizedLocation,
      owner: toLowerAddress(owner || ADMIN_WALLET),
      computeReady: Boolean(computeReady),
      status: typeof status === "string" && status.trim() ? status.trim() : "seed",
      tags: normalizedTags,
      iotaSiteObjectId: normalizedSiteObjectId || null,
      iotaSiteTxDigest: siteMintResult?.txDigest || null,
      iotaChainMode: siteMintResult?.mode || null,
      iotaNotarizationProvider: siteMintResult?.provider || "passport",
      createdAtMs: Date.now(),
    };

    store.sites.push(site);
    await writeStore(store);

    res.status(201).json({ site });
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

    const docsPayload = documents.map((doc) =>
      buildDocPayload(doc, {
        autoHashTypeLabel: "PoolCreationDocument",
      })
    );
    store.pools.push(pool);
    await notarizePoolDocuments({
      store,
      pool,
      site,
      documents: docsPayload,
      adminWallet: ADMIN_WALLET,
    });

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

    let amount = Number(tokenAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "tokenAmount must be > 0" });
    }

    if (REQUIRE_ONCHAIN_CONTRIBUTION) {
      const tokenAmountAsString =
        typeof tokenAmount === "string" ? tokenAmount.trim() : "";
      let amountBigInt = null;

      if (/^[0-9]+$/.test(tokenAmountAsString)) {
        amountBigInt = BigInt(tokenAmountAsString);
      } else if (typeof tokenAmount === "number" && Number.isSafeInteger(tokenAmount)) {
        amountBigInt = BigInt(tokenAmount);
      }

      if (amountBigInt === null || amountBigInt <= 0n) {
        return res.status(400).json({
          error:
            "tokenAmount must be a positive integer when on-chain contribution is enabled",
        });
      }
      if (amountBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return res.status(400).json({
          error: `tokenAmount exceeds safe integer limit (${Number.MAX_SAFE_INTEGER})`,
        });
      }
      amount = Number(amountBigInt);
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

    const [docPayload] = [
      buildDocPayload(
        {
          name,
          docType: "Acquisition Deed",
          driveUrl,
          docHashSha256,
        },
        {
          autoHashTypeLabel: "AcquisitionDeed",
        }
      ),
    ];

    const { proofs } = await notarizePoolDocuments({
      store,
      pool,
      site,
      documents: [docPayload],
      adminWallet: ADMIN_WALLET,
    });
    const proof = proofs[0];

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

router.post("/admin/pools/:poolId/documents/finalize", async (req, res, next) => {
  try {
    requireAdminWallet(req);
    const { documents } = req.body || {};
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "documents array is required" });
    }

    const docsPayload = documents.map((doc) =>
      buildDocPayload(doc, {
        autoHashTypeLabel: "PoolFinalizeDocument",
      })
    );
    const store = await getStore(req);
    const pool = getPoolOrThrow(store, req.params.poolId);
    const site = getSiteOrThrow(store, pool.siteId);
    const statusChangedByDeadline = syncPoolFundingState(pool, Date.now());

    if (
      pool.status !== "open" &&
      pool.status !== "funded" &&
      pool.status !== "acquired" &&
      pool.status !== "operational"
    ) {
      if (statusChangedByDeadline) {
        await writeStore(store);
      }
      return res.status(400).json({
        error:
          "Pool must be open/funded/acquired/operational to finalize additional documents",
      });
    }

    const { proofs, notarizationResult } = await notarizePoolDocuments({
      store,
      pool,
      site,
      documents: docsPayload,
      adminWallet: ADMIN_WALLET,
    });
    await writeStore(store);

    res.status(201).json({
      pool: buildPoolProgress(pool),
      proofs,
      notarization: {
        txDigest: notarizationResult.txDigest || null,
        chainMode: notarizationResult.mode,
        provider: notarizationResult.provider || "passport",
        signedBy: notarizationResult.signedBy || null,
        proofCount: proofs.length,
      },
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

    const docsPayload = Array.isArray(documents)
      ? documents
          .map((rawDoc) => {
            const hasAnyField =
              typeof rawDoc?.name === "string" ||
              typeof rawDoc?.driveUrl === "string" ||
              typeof rawDoc?.docHashSha256 === "string";
            if (!hasAnyField) {
              return null;
            }
            return buildDocPayload(
              {
                ...rawDoc,
                docType:
                  typeof rawDoc?.docType === "string" && rawDoc.docType.trim()
                    ? rawDoc.docType
                    : "Compute Offer Document",
              },
              {
                defaultDocType: "Compute Offer Document",
                autoHashTypeLabel: "ComputeOfferDocument",
              }
            );
          })
          .filter(Boolean)
      : [];

    let notarizedDocs = [];
    if (docsPayload.length > 0) {
      const { proofs } = await notarizePoolDocuments({
        store,
        pool,
        site,
        documents: docsPayload,
        adminWallet: ADMIN_WALLET,
      });
      notarizedDocs = proofs.map((proof) => ({
        id: proof.id,
        name: proof.name,
        driveUrl: proof.driveUrl,
      }));
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
      docs: docsPayload.length > 0 ? notarizedDocs : existing?.docs || [],
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
    if (settleExpiredLegacyRentals(store, Date.now())) {
      await writeStore(store);
    }

    const offers = store.computeOffers
      .filter((offer) => offer.status === "active")
      .map((offer) => {
        const pool = store.pools.find((item) => item.id === offer.poolId) || null;
        const site = store.sites.find((item) => item.id === offer.siteId) || null;
        const proofs = getPoolProofs(store, offer.poolId);
        const mergedDocs = [...(offer.docs || []), ...proofs];
        const seenDocIds = new Set();
        const docs = [];
        for (const item of mergedDocs) {
          if (item && typeof item === "object" && typeof item.id === "string") {
            if (seenDocIds.has(item.id)) {
              continue;
            }
            seenDocIds.add(item.id);
          }
          docs.push(item);
        }

        return {
          ...offer,
          pool: pool ? buildPoolProgress(pool) : null,
          site,
          docs,
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
    if (settleExpiredLegacyRentals(store, Date.now())) {
      await writeStore(store);
    }
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
    const startedAtMs = Date.now();
    const endAtMs = startedAtMs + Math.trunc(hoursNum * HOUR_MS);

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
      timestampMs: startedAtMs,
      startAtMs: startedAtMs,
      endAtMs,
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
    if (settleExpiredLegacyRentals(store, Date.now())) {
      await writeStore(store);
    }

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

router.post("/proofs/:proofId/verify-hash", async (req, res, next) => {
  try {
    const providedHash = normalizeSha256Hash(req.body?.docHashSha256);

    const store = await getStore(req);
    const proof = store.proofs.find((item) => item.id === req.params.proofId);
    if (!proof) {
      return res.status(404).json({ error: "Proof not found" });
    }

    const normalizedExpectedNoPrefix = normalizeSha256Hash(proof.docHashSha256);
    const normalizedProvided = providedHash;

    res.json({
      proofId: proof.id,
      expectedHash: normalizedExpectedNoPrefix,
      providedHash: normalizedProvided,
      hashAlgorithm: "sha256",
      match: normalizedExpectedNoPrefix === normalizedProvided,
      chainMode: proof.chainMode || null,
      iotaTxDigest: proof.iotaTxDigest || null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
