import { randomUUID } from "node:crypto";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { Transaction } from "@iota/iota-sdk/transactions";
import { normalizeIotaAddress } from "@iota/iota-sdk/utils";
import {
  NotarizationClient,
  NotarizationClientReadOnly,
} from "@iota/notarization/node/index.js";
import {
  MOCK_IOTA,
  IOTA_NETWORK,
  getIotaNetworkProfile,
  normalizeIotaNetwork,
  IOTA_GAS_BUDGET,
  IOTA_NOTARIZATION_PROVIDER,
} from "./config.js";

function fakeDigest() {
  return `0x${randomUUID().replaceAll("-", "")}`;
}

function hexToBytes(hex) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex payload for hash bytes");
  }

  const bytes = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }

  return Uint8Array.from(bytes);
}

const U64_MAX = 18_446_744_073_709_551_615n;
const OFFICIAL_NOTARIZATION_MODE = IOTA_NOTARIZATION_PROVIDER === "official_locked";
let activeIotaNetwork = normalizeIotaNetwork(IOTA_NETWORK);
const clientCache = new Map();
const signerCache = new Map();
const officialNotarizationClientPromiseByKey = new Map();

function isMockNetwork(network) {
  return normalizeIotaNetwork(network) === "mock";
}

export function isIotaRuntimeMock(network = activeIotaNetwork) {
  return MOCK_IOTA || isMockNetwork(network);
}

export function getIotaRuntimeMode(network = activeIotaNetwork) {
  return isIotaRuntimeMock(network) ? "mock" : "live";
}

class IotaInteractionSignerAdapter {
  constructor(keypair) {
    this.keypair = keypair;
  }

  async sign(txDataBcs) {
    const signed = await this.keypair.signTransaction(txDataBcs);
    return signed.signature;
  }

  publicKey() {
    return Promise.resolve(this.keypair.getPublicKey());
  }

  iotaPublicKeyBytes() {
    return Promise.resolve(this.keypair.getPublicKey().toIotaBytes());
  }

  keyId() {
    return this.keypair.getPublicKey().toIotaAddress();
  }
}

function resolveFullnodeUrl(profile) {
  const networkForRpc = profile.profileNetwork || profile.network;
  if (profile.fullnodeUrl) {
    return profile.fullnodeUrl;
  }
  if (networkForRpc === "localnet") {
    return "http://127.0.0.1:9000";
  }
  return getFullnodeUrl(networkForRpc === "mainnet" ? "mainnet" : "testnet");
}

function getClientForProfile(profile) {
  const url = resolveFullnodeUrl(profile);
  const cacheKey = `${profile.network}|${url}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new IotaClient({ url });
    clientCache.set(cacheKey, client);
  }
  return { client, url };
}

function getSignerForProfile(profile) {
  const secretKey = profile.signerSecretKey || "";
  if (!secretKey) {
    return null;
  }
  if (signerCache.has(secretKey)) {
    return signerCache.get(secretKey);
  }
  try {
    const signer = Ed25519Keypair.fromSecretKey(secretKey);
    signerCache.set(secretKey, signer);
    return signer;
  } catch (cause) {
    throw createHttpError(
      `Invalid IOTA signer secret key configured for network ${profile.network}`,
      500,
      cause
    );
  }
}

function getRuntime() {
  const profile = getIotaNetworkProfile(activeIotaNetwork);
  const { client, url } = getClientForProfile(profile);
  const signer = getSignerForProfile(profile);
  const mode = getIotaRuntimeMode(profile.network);

  return {
    ...profile,
    rpcUrl: url,
    mode,
    client,
    signer,
  };
}

export function setActiveIotaNetwork(network) {
  activeIotaNetwork = normalizeIotaNetwork(network);
  return activeIotaNetwork;
}

export function getActiveIotaNetwork() {
  return activeIotaNetwork;
}

export function getIotaRuntimeInfo() {
  const runtime = getRuntime();
  return {
    mode: runtime.mode,
    activeNetwork: runtime.network,
    profileNetwork: runtime.profileNetwork,
    rpcUrl: runtime.rpcUrl,
    packageId: runtime.packageId || null,
    escrowPackageId: runtime.escrowPackageId || null,
    hasSigner: Boolean(runtime.signer),
    signerAddress: runtime.signer ? runtime.signer.toIotaAddress() : null,
  };
}

function assertPassportReady(runtime) {
  if (!runtime.packageId) {
    throw new Error(
      `IOTA package ID is required for passport notarization mode on ${runtime.network}`
    );
  }

  if (!runtime.signer) {
    throw new Error(
      `IOTA signer secret key is required for live IOTA operations on ${runtime.network}`
    );
  }
}

function assertSignerReady(runtime) {
  if (!runtime.signer) {
    throw new Error(
      `IOTA signer secret key is required for backend-signed IOTA operations on ${runtime.network}`
    );
  }
}

async function getOfficialNotarizationClient(runtime) {
  assertSignerReady(runtime);
  const cacheKey = `${runtime.network}|${runtime.rpcUrl}|${runtime.signer.toIotaAddress()}`;
  if (!officialNotarizationClientPromiseByKey.has(cacheKey)) {
    officialNotarizationClientPromiseByKey.set(
      cacheKey,
      (async () => {
        try {
          const readOnly = await NotarizationClientReadOnly.create(runtime.client);
          const signerAdapter = new IotaInteractionSignerAdapter(runtime.signer);
          return await NotarizationClient.create(readOnly, signerAdapter);
        } catch (error) {
          throw createHttpError(
            `Unable to initialize official IOTA notarization client: ${error.message || String(error)}`,
            500,
            error
          );
        }
      })()
    );
  }

  try {
    return await officialNotarizationClientPromiseByKey.get(cacheKey);
  } catch (error) {
    officialNotarizationClientPromiseByKey.delete(cacheKey);
    throw error;
  }
}

function parseCreatedObjectId(response, typeHint) {
  const created = response?.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      typeof change.objectType === "string" &&
      change.objectType.includes(typeHint)
  );

  return created?.objectId ?? null;
}

function parseCreatedObjectIds(response, typeHint) {
  return (response?.objectChanges || [])
    .filter(
      (change) =>
        change.type === "created" &&
        typeof change.objectType === "string" &&
        change.objectType.includes(typeHint) &&
        typeof change.objectId === "string"
    )
    .map((change) => change.objectId);
}

function createHttpError(message, status, cause) {
  const error = new Error(message);
  error.status = status;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function toNormalizedAddress(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const maybeHex = trimmed.startsWith("0x")
    ? trimmed
    : /^[0-9a-fA-F]+$/.test(trimmed)
      ? `0x${trimmed}`
      : trimmed;

  try {
    return normalizeIotaAddress(maybeHex);
  } catch {
    return maybeHex.toLowerCase();
  }
}

function toNormalizedObjectId(value) {
  return toNormalizedAddress(value);
}

function getEventByTypeSuffix(events, suffix) {
  if (!Array.isArray(events)) {
    return null;
  }
  return (
    events.find(
      (item) => typeof item?.type === "string" && item.type.endsWith(suffix)
    ) || null
  );
}

function readParsedEventField(parsedJson, keys) {
  if (!parsedJson || typeof parsedJson !== "object") {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(parsedJson, key)) {
      return parsedJson[key];
    }
  }
  return null;
}

export function getBackendSignerAddress() {
  let runtime;
  try {
    runtime = getRuntime();
  } catch {
    return null;
  }
  if (!runtime.signer) {
    return null;
  }
  return runtime.signer.toIotaAddress();
}

export async function createSitePassportOnIota(payload) {
  if (isIotaRuntimeMock()) {
    return {
      mode: "mock",
      provider: "passport",
      objectId: fakeDigest(),
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      payload,
    };
  }

  const runtime = getRuntime();
  assertPassportReady(runtime);

  const areaM2 = BigInt(payload.areaM2 || 0);
  const targetKw = BigInt(payload.targetKw || 0);
  if (areaM2 <= 0n) {
    throw new Error("areaM2 must be > 0 to mint site passport");
  }
  if (targetKw < 0n) {
    throw new Error("targetKw must be >= 0 to mint site passport");
  }

  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  tx.moveCall({
    target: `${runtime.packageId}::passport::mint_site_nft`,
    arguments: [
      tx.pure.string(payload.siteCode),
      tx.pure.string(payload.siteType),
      tx.pure.u64(areaM2),
      tx.pure.u64(targetKw),
      tx.pure.string(payload.approxLocation),
    ],
  });

  const response = await runtime.client.signAndExecuteTransaction({
    signer: runtime.signer,
    transaction: tx,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showEvents: true,
    },
  });
  const siteObjectId = parseCreatedObjectId(response, "SiteNFT");
  if (!siteObjectId) {
    throw createHttpError(
      "SiteNFT creation transaction succeeded but created object ID was not detected",
      502,
      response
    );
  }

  return {
    mode: "live",
    provider: "passport",
    objectId: siteObjectId,
    txDigest: response.digest,
    timestampMs: Number(response.timestampMs || Date.now()),
    signedBy: runtime.signer.toIotaAddress(),
    payload,
  };
}

export async function createPoolEscrowOnIota(payload) {
  const runtime = getRuntime();
  const normalizedTreasury = toNormalizedAddress(payload?.treasuryWallet || "");
  const hardCapNanoIota = BigInt(payload?.hardCapNanoIota || 0);
  const deadlineMs = BigInt(payload?.deadlineMs || 0);
  const nowMs = BigInt(Date.now());

  if (!normalizedTreasury) {
    throw createHttpError("Escrow treasury wallet is required", 400);
  }
  if (hardCapNanoIota <= 0n || hardCapNanoIota > U64_MAX) {
    throw createHttpError("hardCapNanoIota must be in range (0, u64]", 400);
  }
  if (deadlineMs <= nowMs || deadlineMs > U64_MAX) {
    throw createHttpError("deadlineMs must be in the future and <= u64", 400);
  }

  if (runtime.mode === "mock") {
    return {
      mode: "mock",
      provider: "pool_escrow",
      objectId: fakeDigest(),
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      signedBy: getBackendSignerAddress(),
      payload: {
        hardCapNanoIota: hardCapNanoIota.toString(),
        deadlineMs: deadlineMs.toString(),
        treasuryWallet: normalizedTreasury,
      },
    };
  }

  assertSignerReady(runtime);
  if (!runtime.escrowPackageId) {
    throw createHttpError(
      `Escrow package ID is required for on-chain escrow mode on ${runtime.network}`,
      500
    );
  }

  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  tx.moveCall({
    target: `${runtime.escrowPackageId}::pool_escrow::create_pool`,
    arguments: [
      tx.pure.u64(hardCapNanoIota),
      tx.pure.u64(deadlineMs),
      tx.pure.address(normalizedTreasury),
      tx.object("0x6"),
    ],
  });

  let response;
  try {
    response = await runtime.client.signAndExecuteTransaction({
      signer: runtime.signer,
      transaction: tx,
      options: {
        showObjectChanges: true,
        showEffects: true,
        showEvents: true,
      },
    });
  } catch (error) {
    throw createHttpError(
      `Failed to create on-chain escrow pool: ${error.message || String(error)}`,
      502,
      error
    );
  }

  const objectId = parseCreatedObjectId(response, "PoolEscrow");
  if (!objectId) {
    throw createHttpError(
      "Escrow creation tx succeeded but PoolEscrow object ID was not detected",
      502,
      response
    );
  }

  return {
    mode: "live",
    provider: "pool_escrow",
    objectId,
    txDigest: response.digest,
    timestampMs: Number(response.timestampMs || Date.now()),
    signedBy: runtime.signer.toIotaAddress(),
    payload: {
      hardCapNanoIota: hardCapNanoIota.toString(),
      deadlineMs: deadlineMs.toString(),
      treasuryWallet: normalizedTreasury,
      packageId: runtime.escrowPackageId,
      network: runtime.network,
    },
  };
}

export async function withdrawFromEscrowOnIota(payload) {
  const runtime = getRuntime();
  const poolEscrowObjectId = toNormalizedObjectId(payload?.poolEscrowObjectId || "");
  const amountNanoIota = BigInt(payload?.amountNanoIota || 0);
  if (!poolEscrowObjectId) {
    throw createHttpError("poolEscrowObjectId is required", 400);
  }
  if (amountNanoIota <= 0n || amountNanoIota > U64_MAX) {
    throw createHttpError("amountNanoIota must be in range (0, u64]", 400);
  }

  if (runtime.mode === "mock") {
    return {
      mode: "mock",
      provider: "pool_escrow",
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      signedBy: getBackendSignerAddress(),
      amountNanoIota: amountNanoIota.toString(),
      poolEscrowObjectId,
    };
  }

  assertSignerReady(runtime);
  if (!runtime.escrowPackageId) {
    throw createHttpError(
      `Escrow package ID is required for on-chain escrow mode on ${runtime.network}`,
      500
    );
  }

  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  tx.moveCall({
    target: `${runtime.escrowPackageId}::pool_escrow::withdraw_to_treasury`,
    arguments: [
      tx.object(poolEscrowObjectId),
      tx.pure.u64(amountNanoIota),
      tx.object("0x6"),
    ],
  });

  let response;
  try {
    response = await runtime.client.signAndExecuteTransaction({
      signer: runtime.signer,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
  } catch (error) {
    throw createHttpError(
      `Failed to withdraw from on-chain escrow pool: ${error.message || String(error)}`,
      502,
      error
    );
  }

  if (!response?.digest) {
    throw createHttpError("Escrow withdraw tx did not return a digest", 502, response);
  }
  if (response.effects?.status?.status !== "success") {
    throw createHttpError(
      `Escrow withdraw tx failed: ${response.effects?.status?.error || "unknown error"}`,
      502,
      response
    );
  }

  return {
    mode: "live",
    provider: "pool_escrow",
    txDigest: response.digest,
    timestampMs: Number(response.timestampMs || Date.now()),
    signedBy: runtime.signer.toIotaAddress(),
    amountNanoIota: amountNanoIota.toString(),
    poolEscrowObjectId,
  };
}

export async function createBatchNotarizationOnIota(payload) {
  const runtime = getRuntime();
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (entries.length === 0) {
    throw new Error("entries array is required for batch notarization");
  }
  const provider = OFFICIAL_NOTARIZATION_MODE ? "official_locked" : "passport";

  if (runtime.mode === "mock") {
    const txDigest = fakeDigest();
    const timestampMs = Date.now();
    return {
      mode: "mock",
      provider,
      txDigest,
      timestampMs,
      signedBy: getBackendSignerAddress(),
      proofs: entries.map((entry, index) => ({
        index,
        objectId: fakeDigest(),
        docType: entry.docType,
        fileName: entry.fileName,
        fileHash: entry.fileHash,
        timestampMs,
        txDigest,
        provider,
      })),
    };
  }

  if (OFFICIAL_NOTARIZATION_MODE) {
    let txOutput;
    try {
      const notarizationClient = await getOfficialNotarizationClient(runtime);
      const manifestState = JSON.stringify({
        schema: "computebasin.doc-batch.v1",
        siteId: payload.siteId || null,
        siteObjectId: payload.siteObjectId || null,
        hashAlgorithm: "sha256",
        entries: entries.map((entry, index) => ({
          index,
          docType: entry.docType,
          fileName: entry.fileName || null,
          fileHash: entry.fileHash,
          timestampMs: entry.timestampMs ?? Date.now(),
        })),
      });
      const metadata = JSON.stringify({
        entryCount: entries.length,
        siteId: payload.siteId || null,
      });
      txOutput = await notarizationClient
        .createLocked()
        .withStringState(manifestState, metadata)
        .withImmutableDescription(
          `ComputeBasin document batch notarization (${entries.length} entries)`
        )
        .finish()
        .buildAndExecute(notarizationClient);
    } catch (error) {
      throw createHttpError(
        `Official notarization transaction failed: ${error.message || String(error)}`,
        502,
        error
      );
    }

    const txDigest = txOutput?.response?.digest;
    if (!txDigest) {
      throw createHttpError(
        "Official notarization transaction returned no digest",
        502,
        txOutput
      );
    }
    const timestampMs = Number(txOutput?.response?.timestampMs || Date.now());
    const notarizationObjectId = txOutput?.output?.id;
    if (!notarizationObjectId) {
      throw createHttpError(
        "Official notarization transaction returned no notarization object ID",
        502,
        txOutput
      );
    }
    return {
      mode: "live",
      provider,
      txDigest,
      timestampMs,
      signedBy: runtime.signer.toIotaAddress(),
      proofs: entries.map((entry, index) => ({
        index,
        objectId: notarizationObjectId,
        docType: entry.docType,
        fileName: entry.fileName,
        fileHash: entry.fileHash,
        timestampMs,
        txDigest,
        provider,
      })),
    };
  }

  assertPassportReady(runtime);
  if (!payload.siteObjectId) {
    throw new Error(`Missing iotaSiteObjectId for site ${payload.siteId}`);
  }
  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  for (const entry of entries) {
    const timestampMs = entry.timestampMs ?? Date.now();
    const hashBytes = hexToBytes(entry.fileHash);
    tx.moveCall({
      target: `${runtime.packageId}::passport::notarize_document`,
      arguments: [
        tx.object(payload.siteObjectId),
        tx.pure.string(entry.docType),
        tx.pure.vector("u8", Array.from(hashBytes)),
        tx.pure.u64(BigInt(timestampMs)),
      ],
    });
  }

  const response = await runtime.client.signAndExecuteTransaction({
    signer: runtime.signer,
    transaction: tx,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showEvents: true,
    },
  });

  const createdProofIds = parseCreatedObjectIds(response, "DocProof");
  if (createdProofIds.length < entries.length) {
    throw createHttpError(
      `Passport notarization created ${createdProofIds.length} proofs, expected ${entries.length}`,
      502,
      response
    );
  }
  const timestampMs = Number(response.timestampMs || Date.now());
  return {
    mode: "live",
    provider,
    txDigest: response.digest,
    timestampMs,
    signedBy: runtime.signer.toIotaAddress(),
    proofs: entries.map((entry, index) => ({
      index,
      objectId: createdProofIds[index] || null,
      docType: entry.docType,
      fileName: entry.fileName,
      fileHash: entry.fileHash,
      timestampMs,
      txDigest: response.digest,
      provider,
    })),
  };
}

export async function verifyEscrowContributionTx({
  txDigest,
  expectedFromWallet,
  expectedPoolEscrowObjectId,
  minimumAmountNanoIota,
}) {
  const runtime = getRuntime();
  const expectedSender = toNormalizedAddress(expectedFromWallet);
  const expectedPoolId = toNormalizedObjectId(expectedPoolEscrowObjectId);
  const minAmount = BigInt(minimumAmountNanoIota || 0);
  if (!expectedPoolId) {
    throw createHttpError("expectedPoolEscrowObjectId is required", 400);
  }
  if (minAmount <= 0n) {
    throw createHttpError("minimumAmountNanoIota must be > 0", 400);
  }
  if (runtime.mode === "mock") {
    return {
      txDigest: txDigest || fakeDigest(),
      sender: expectedSender || "mock_sender",
      poolEscrowObjectId: expectedPoolId,
      amountNanoIota: minAmount.toString(),
      receiptObjectId: fakeDigest(),
      eventType: "mock::pool_escrow::ContributionAccepted",
      recipient: null,
      coinType: "iota::iota::IOTA",
    };
  }

  if (!txDigest) {
    throw createHttpError("paymentTxDigest is required", 400);
  }

  let response;
  try {
    response = await runtime.client.getTransactionBlock({
      digest: txDigest,
      options: {
        showInput: true,
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
  } catch (cause) {
    throw createHttpError(
      `Unable to fetch escrow contribution transaction ${txDigest} from IOTA RPC`,
      502,
      cause
    );
  }

  if (!response || !response.digest) {
    throw createHttpError(`Transaction ${txDigest} not found`, 400);
  }
  const txStatus = response.effects?.status?.status;
  if (txStatus !== "success") {
    throw createHttpError(
      `Escrow contribution transaction ${txDigest} failed: ${response.effects?.status?.error || "unknown error"}`,
      400
    );
  }

  const sender = toNormalizedAddress(response.transaction?.data?.sender || "");
  if (!sender) {
    throw createHttpError(
      `Unable to inspect sender for escrow contribution transaction ${txDigest}`,
      400
    );
  }
  if (expectedSender && sender !== expectedSender) {
    throw createHttpError(
      `Escrow contribution sender ${sender} does not match contributor wallet ${expectedSender}`,
      400
    );
  }

  const contributionEvent = getEventByTypeSuffix(
    response.events,
    "::pool_escrow::ContributionAccepted"
  );
  if (!contributionEvent) {
    throw createHttpError(
      `Escrow contribution tx ${txDigest} does not include ContributionAccepted event`,
      400
    );
  }

  const parsedJson = contributionEvent.parsedJson || null;
  const eventPoolIdRaw = readParsedEventField(parsedJson, ["pool_id", "poolId"]);
  const eventContributorRaw = readParsedEventField(parsedJson, [
    "contributor",
    "wallet",
    "wallet_address",
  ]);
  const eventAmountRaw = readParsedEventField(parsedJson, [
    "amount_nanos",
    "amountNanoIota",
    "amount",
  ]);
  const eventReceiptRaw = readParsedEventField(parsedJson, ["receipt_id", "receiptId"]);

  const eventPoolId = toNormalizedObjectId(String(eventPoolIdRaw || ""));
  if (!eventPoolId || eventPoolId !== expectedPoolId) {
    throw createHttpError(
      `Escrow contribution tx ${txDigest} targets pool ${eventPoolId || "unknown"}, expected ${expectedPoolId}`,
      400
    );
  }

  const eventContributor = toNormalizedAddress(String(eventContributorRaw || ""));
  if (!eventContributor || eventContributor !== expectedSender) {
    throw createHttpError(
      `Escrow contribution tx ${txDigest} contributor ${eventContributor || "unknown"} does not match ${expectedSender}`,
      400
    );
  }

  const amountNanoIota = BigInt(String(eventAmountRaw || "0"));
  if (amountNanoIota < minAmount) {
    throw createHttpError(
      `Escrow contribution tx ${txDigest} accepted ${amountNanoIota.toString()} nanoIOTA, expected at least ${minAmount.toString()}`,
      400
    );
  }

  return {
    txDigest: response.digest,
    sender,
    poolEscrowObjectId: expectedPoolId,
    amountNanoIota: amountNanoIota.toString(),
    receiptObjectId: toNormalizedObjectId(String(eventReceiptRaw || "")) || null,
    eventType: contributionEvent.type,
  };
}

export async function verifyEscrowRefundTx({
  txDigest,
  expectedFromWallet,
  expectedPoolEscrowObjectId,
}) {
  const runtime = getRuntime();
  const expectedSender = toNormalizedAddress(expectedFromWallet);
  const expectedPoolId = toNormalizedObjectId(expectedPoolEscrowObjectId);
  if (!expectedPoolId) {
    throw createHttpError("expectedPoolEscrowObjectId is required", 400);
  }
  if (runtime.mode === "mock") {
    return {
      txDigest: txDigest || fakeDigest(),
      sender: expectedSender || "mock_sender",
      poolEscrowObjectId: expectedPoolId,
      amountNanoIota: "1",
      receiptObjectId: fakeDigest(),
      eventType: "mock::pool_escrow::RefundClaimed",
    };
  }

  if (!txDigest) {
    throw createHttpError("refundTxDigest is required", 400);
  }

  let response;
  try {
    response = await runtime.client.getTransactionBlock({
      digest: txDigest,
      options: {
        showInput: true,
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
  } catch (cause) {
    throw createHttpError(
      `Unable to fetch escrow refund transaction ${txDigest} from IOTA RPC`,
      502,
      cause
    );
  }

  if (!response || !response.digest) {
    throw createHttpError(`Transaction ${txDigest} not found`, 400);
  }
  const txStatus = response.effects?.status?.status;
  if (txStatus !== "success") {
    throw createHttpError(
      `Escrow refund transaction ${txDigest} failed: ${response.effects?.status?.error || "unknown error"}`,
      400
    );
  }

  const sender = toNormalizedAddress(response.transaction?.data?.sender || "");
  if (!sender) {
    throw createHttpError(
      `Unable to inspect sender for escrow refund transaction ${txDigest}`,
      400
    );
  }
  if (expectedSender && sender !== expectedSender) {
    throw createHttpError(
      `Escrow refund sender ${sender} does not match contributor wallet ${expectedSender}`,
      400
    );
  }

  const refundEvent = getEventByTypeSuffix(response.events, "::pool_escrow::RefundClaimed");
  if (!refundEvent) {
    throw createHttpError(
      `Escrow refund tx ${txDigest} does not include RefundClaimed event`,
      400
    );
  }

  const parsedJson = refundEvent.parsedJson || null;
  const eventPoolIdRaw = readParsedEventField(parsedJson, ["pool_id", "poolId"]);
  const eventContributorRaw = readParsedEventField(parsedJson, [
    "contributor",
    "wallet",
    "wallet_address",
  ]);
  const eventAmountRaw = readParsedEventField(parsedJson, [
    "amount_nanos",
    "amountNanoIota",
    "amount",
  ]);
  const eventReceiptRaw = readParsedEventField(parsedJson, ["receipt_id", "receiptId"]);

  const eventPoolId = toNormalizedObjectId(String(eventPoolIdRaw || ""));
  if (!eventPoolId || eventPoolId !== expectedPoolId) {
    throw createHttpError(
      `Escrow refund tx ${txDigest} targets pool ${eventPoolId || "unknown"}, expected ${expectedPoolId}`,
      400
    );
  }

  const eventContributor = toNormalizedAddress(String(eventContributorRaw || ""));
  if (!eventContributor || eventContributor !== expectedSender) {
    throw createHttpError(
      `Escrow refund tx ${txDigest} contributor ${eventContributor || "unknown"} does not match ${expectedSender}`,
      400
    );
  }

  const amountNanoIota = BigInt(String(eventAmountRaw || "0"));
  if (amountNanoIota <= 0n) {
    throw createHttpError(
      `Escrow refund tx ${txDigest} has invalid refunded amount ${amountNanoIota.toString()}`,
      400
    );
  }

  return {
    txDigest: response.digest,
    sender,
    poolEscrowObjectId: expectedPoolId,
    amountNanoIota: amountNanoIota.toString(),
    receiptObjectId: toNormalizedObjectId(String(eventReceiptRaw || "")) || null,
    eventType: refundEvent.type,
  };
}
