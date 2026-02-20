import { randomUUID } from "node:crypto";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_TYPE_ARG, normalizeIotaAddress } from "@iota/iota-sdk/utils";
import {
  NotarizationClient,
  NotarizationClientReadOnly,
} from "@iota/notarization/node/index.js";
import {
  MOCK_IOTA,
  IOTA_FULLNODE_URL,
  IOTA_NETWORK,
  IOTA_PACKAGE_ID,
  IOTA_SIGNER_SECRET_KEY,
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

const client = new IotaClient({
  url: IOTA_FULLNODE_URL || getFullnodeUrl(IOTA_NETWORK),
});

const signer = IOTA_SIGNER_SECRET_KEY
  ? Ed25519Keypair.fromSecretKey(IOTA_SIGNER_SECRET_KEY)
  : null;
const PAYMENT_VERIFY_MAX_ATTEMPTS = 4;
const PAYMENT_VERIFY_RETRY_DELAY_MS = 1200;
const OFFICIAL_NOTARIZATION_MODE = IOTA_NOTARIZATION_PROVIDER === "official_locked";
let officialNotarizationClientPromise = null;

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

function assertPassportReady() {
  if (!IOTA_PACKAGE_ID) {
    throw new Error("IOTA_PACKAGE_ID is required for passport notarization mode");
  }

  if (!signer) {
    throw new Error("IOTA_SIGNER_SECRET_KEY is required for live IOTA operations");
  }
}

function assertSignerReady() {
  if (!signer) {
    throw new Error("IOTA_SIGNER_SECRET_KEY is required for backend-signed IOTA transfers");
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOfficialNotarizationClient() {
  assertSignerReady();
  if (!officialNotarizationClientPromise) {
    officialNotarizationClientPromise = (async () => {
      try {
        const readOnly = await NotarizationClientReadOnly.create(client);
        const signerAdapter = new IotaInteractionSignerAdapter(signer);
        return await NotarizationClient.create(readOnly, signerAdapter);
      } catch (error) {
        throw createHttpError(
          `Unable to initialize official IOTA notarization client: ${error.message || String(error)}`,
          500,
          error
        );
      }
    })();
  }

  try {
    return await officialNotarizationClientPromise;
  } catch (error) {
    officialNotarizationClientPromise = null;
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

function extractAddressOwner(owner) {
  if (!owner || typeof owner !== "object") {
    return "";
  }

  if ("AddressOwner" in owner && typeof owner.AddressOwner === "string") {
    return toNormalizedAddress(owner.AddressOwner);
  }

  return "";
}

function toBigIntValue(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function getPureInputValue(inputs, index) {
  const input = Array.isArray(inputs) ? inputs[index] : null;
  if (!input || input.type !== "pure") {
    return null;
  }
  return input.value;
}

function resolveAmountFromInputArg(arg, inputs) {
  if (!arg || typeof arg !== "object" || !("Input" in arg)) {
    return null;
  }
  const pure = getPureInputValue(inputs, arg.Input);
  return toBigIntValue(pure);
}

function resolveAddressFromInputArg(arg, inputs) {
  if (!arg || typeof arg !== "object" || !("Input" in arg)) {
    return "";
  }
  const pure = getPureInputValue(inputs, arg.Input);
  if (typeof pure !== "string") {
    return "";
  }
  return toNormalizedAddress(pure);
}

function amountFromResultArg(arg, splitAmountsByTxIndex) {
  if (!arg || typeof arg !== "object") {
    return 0n;
  }

  if ("Result" in arg && Number.isInteger(arg.Result)) {
    const amounts = splitAmountsByTxIndex.get(arg.Result);
    if (!Array.isArray(amounts) || amounts.length === 0) {
      return 0n;
    }
    return amounts.reduce((sum, value) => sum + value, 0n);
  }

  if ("NestedResult" in arg && Array.isArray(arg.NestedResult)) {
    const [txIndex, nestedIndex] = arg.NestedResult;
    if (!Number.isInteger(txIndex) || !Number.isInteger(nestedIndex)) {
      return 0n;
    }
    const amounts = splitAmountsByTxIndex.get(txIndex);
    if (!Array.isArray(amounts)) {
      return 0n;
    }
    return amounts[nestedIndex] || 0n;
  }

  return 0n;
}

function extractTransferredAmountFromInputs(response, expectedRecipient) {
  const tx = response?.transaction?.data?.transaction;
  if (!tx || tx.kind !== "ProgrammableTransaction") {
    return 0n;
  }

  const inputs = Array.isArray(tx.inputs) ? tx.inputs : [];
  const transactions = Array.isArray(tx.transactions) ? tx.transactions : [];
  const splitAmountsByTxIndex = new Map();

  // Track split amounts by command index, then resolve TransferObjects command recipients.
  for (let commandIndex = 0; commandIndex < transactions.length; commandIndex += 1) {
    const command = transactions[commandIndex];
    if (!command || typeof command !== "object") {
      continue;
    }

    if ("SplitCoins" in command) {
      const split = command.SplitCoins;
      if (!Array.isArray(split) || split.length < 2 || !Array.isArray(split[1])) {
        continue;
      }

      const amounts = split[1]
        .map((item) => resolveAmountFromInputArg(item, inputs))
        .filter((value) => typeof value === "bigint");
      splitAmountsByTxIndex.set(commandIndex, amounts);
    }
  }

  let transferredAmount = 0n;
  for (const command of transactions) {
    if (!command || typeof command !== "object" || !("TransferObjects" in command)) {
      continue;
    }

    const transfer = command.TransferObjects;
    if (!Array.isArray(transfer) || transfer.length < 2 || !Array.isArray(transfer[0])) {
      continue;
    }

    const recipient = resolveAddressFromInputArg(transfer[1], inputs);
    if (!recipient || recipient !== expectedRecipient) {
      continue;
    }

    for (const objectArg of transfer[0]) {
      transferredAmount += amountFromResultArg(objectArg, splitAmountsByTxIndex);
    }
  }

  return transferredAmount;
}

export function getBackendSignerAddress() {
  if (!signer) {
    return null;
  }
  return signer.toIotaAddress();
}

export async function createSitePassportOnIota(payload) {
  if (MOCK_IOTA) {
    return {
      mode: "mock",
      provider: "passport",
      objectId: fakeDigest(),
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      payload,
    };
  }

  assertPassportReady();

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
    target: `${IOTA_PACKAGE_ID}::passport::mint_site_nft`,
    arguments: [
      tx.pure.string(payload.siteCode),
      tx.pure.string(payload.siteType),
      tx.pure.u64(areaM2),
      tx.pure.u64(targetKw),
      tx.pure.string(payload.approxLocation),
    ],
  });

  const response = await client.signAndExecuteTransaction({
    signer,
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
    signedBy: signer.toIotaAddress(),
    payload,
  };
}

export async function createBatchNotarizationOnIota(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (entries.length === 0) {
    throw new Error("entries array is required for batch notarization");
  }
  const provider = OFFICIAL_NOTARIZATION_MODE ? "official_locked" : "passport";

  if (MOCK_IOTA) {
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
      const notarizationClient = await getOfficialNotarizationClient();
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
      signedBy: signer.toIotaAddress(),
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

  assertPassportReady();
  if (!payload.siteObjectId) {
    throw new Error(`Missing iotaSiteObjectId for site ${payload.siteId}`);
  }
  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  for (const entry of entries) {
    const timestampMs = entry.timestampMs ?? Date.now();
    const hashBytes = hexToBytes(entry.fileHash);
    tx.moveCall({
      target: `${IOTA_PACKAGE_ID}::passport::notarize_document`,
      arguments: [
        tx.object(payload.siteObjectId),
        tx.pure.string(entry.docType),
        tx.pure.vector("u8", Array.from(hashBytes)),
        tx.pure.u64(BigInt(timestampMs)),
      ],
    });
  }

  const response = await client.signAndExecuteTransaction({
    signer,
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
    signedBy: signer.toIotaAddress(),
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

export async function createNotarizationOnIota(payload) {
  const result = await createBatchNotarizationOnIota({
    siteId: payload.siteId,
    siteObjectId: payload.siteObjectId,
    entries: [
      {
        docType: payload.docType,
        fileHash: payload.fileHash,
        fileName: payload.fileName,
        timestampMs: payload.timestampMs ?? Date.now(),
      },
    ],
  });
  const firstProof = result.proofs[0];
  if (!firstProof) {
    throw createHttpError("Notarization result did not include any proof entry", 502, result);
  }
  return {
    mode: result.mode,
    provider: result.provider,
    objectId: firstProof.objectId || null,
    txDigest: result.txDigest,
    timestampMs: firstProof.timestampMs || result.timestampMs || Date.now(),
    signedBy: result.signedBy || null,
    payload,
  };
}

export async function mintReservationOnIota(payload) {
  if (MOCK_IOTA) {
    return {
      mode: "mock",
      reservationObjectId: fakeDigest(),
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      payload,
    };
  }

  assertPassportReady();

  if (!payload.siteObjectId) {
    throw new Error(`Missing iotaSiteObjectId for site ${payload.siteId}`);
  }

  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  tx.moveCall({
    target: `${IOTA_PACKAGE_ID}::passport::reserve_capacity_for`,
    arguments: [
      tx.object(payload.siteObjectId),
      tx.pure.u64(BigInt(payload.reservedKwUnits)),
      tx.pure.u64(BigInt(payload.expiresAtMs)),
      tx.pure.address(payload.walletAddress),
    ],
  });

  const response = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showEvents: true,
    },
  });

  return {
    mode: "live",
    reservationObjectId:
      parseCreatedObjectId(response, "ReservationToken") || fakeDigest(),
    txDigest: response.digest,
    timestampMs: Number(response.timestampMs || Date.now()),
    payload,
  };
}

export async function resolveReservationFromDigest(txDigest) {
  if (MOCK_IOTA) {
    return {
      reservationObjectId: null,
      timestampMs: Date.now(),
    };
  }

  const response = await client.getTransactionBlock({
    digest: txDigest,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showEvents: true,
    },
  });

  return {
    reservationObjectId: parseCreatedObjectId(response, "ReservationToken"),
    timestampMs: Number(response.timestampMs || Date.now()),
  };
}

export async function verifyIotaPaymentTx({
  txDigest,
  expectedFromWallet,
  expectedToWallet,
  minimumAmountNanoIota,
}) {
  if (!txDigest) {
    throw createHttpError("paymentTxDigest is required", 400);
  }

  const expectedSender = toNormalizedAddress(expectedFromWallet);
  const expectedRecipient = toNormalizedAddress(expectedToWallet);
  const minAmount = BigInt(minimumAmountNanoIota);

  let lastResponse = null;
  let lastObservedAmount = 0n;
  let lastBalanceChangeAmount = 0n;
  let lastInputTransferAmount = 0n;

  for (let attempt = 1; attempt <= PAYMENT_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await client.getTransactionBlock({
        digest: txDigest,
        options: {
          showInput: true,
          showEffects: true,
          showBalanceChanges: true,
        },
      });
    } catch (cause) {
      if (attempt < PAYMENT_VERIFY_MAX_ATTEMPTS) {
        await sleep(PAYMENT_VERIFY_RETRY_DELAY_MS);
        continue;
      }
      throw createHttpError(
        `Unable to fetch payment transaction ${txDigest} from IOTA RPC`,
        502,
        cause
      );
    }

    if (!response || !response.digest) {
      if (attempt < PAYMENT_VERIFY_MAX_ATTEMPTS) {
        await sleep(PAYMENT_VERIFY_RETRY_DELAY_MS);
        continue;
      }
      throw createHttpError(`Transaction ${txDigest} not found`, 400);
    }

    const txStatus = response.effects?.status?.status;
    if (txStatus !== "success") {
      throw createHttpError(
        `Payment transaction ${txDigest} failed: ${response.effects?.status?.error || "unknown error"}`,
        400
      );
    }

    const sender = toNormalizedAddress(response.transaction?.data?.sender || "");
    if (!sender) {
      if (attempt < PAYMENT_VERIFY_MAX_ATTEMPTS) {
        await sleep(PAYMENT_VERIFY_RETRY_DELAY_MS);
        continue;
      }
      throw createHttpError(
        `Unable to inspect sender for payment transaction ${txDigest}`,
        400
      );
    }

    if (expectedSender && sender !== expectedSender) {
      throw createHttpError(
        `Payment transaction sender ${sender} does not match contributor wallet ${expectedSender}`,
        400
      );
    }

    const receivedAmountNanoIota = (response.balanceChanges || [])
      .filter((change) => typeof change.coinType === "string")
      .filter((change) => change.coinType.toLowerCase() === IOTA_TYPE_ARG.toLowerCase())
      .filter((change) => extractAddressOwner(change.owner) === expectedRecipient)
      .reduce((total, change) => {
        const amount = BigInt(change.amount || "0");
        return amount > 0n ? total + amount : total;
      }, 0n);
    const transferredAmountFromInputs = extractTransferredAmountFromInputs(
      response,
      expectedRecipient
    );
    const observedAmountNanoIota =
      receivedAmountNanoIota > transferredAmountFromInputs
        ? receivedAmountNanoIota
        : transferredAmountFromInputs;

    lastResponse = response;
    lastObservedAmount = observedAmountNanoIota;
    lastBalanceChangeAmount = receivedAmountNanoIota;
    lastInputTransferAmount = transferredAmountFromInputs;

    if (observedAmountNanoIota >= minAmount) {
      return {
        txDigest: response.digest,
        sender,
        recipient: expectedRecipient,
        coinType: IOTA_TYPE_ARG,
        amountNanoIota: observedAmountNanoIota.toString(),
        balanceChangesAmountNanoIota: receivedAmountNanoIota.toString(),
        inputTransferAmountNanoIota: transferredAmountFromInputs.toString(),
      };
    }

    if (attempt < PAYMENT_VERIFY_MAX_ATTEMPTS) {
      await sleep(PAYMENT_VERIFY_RETRY_DELAY_MS);
      continue;
    }
  }

  throw createHttpError(
    `Payment transaction ${txDigest} sent ${lastObservedAmount.toString()} nanoIOTA to ${expectedRecipient}, expected at least ${minAmount.toString()} (balanceChanges=${lastBalanceChangeAmount.toString()}, parsedInputs=${lastInputTransferAmount.toString()})`,
    400,
    lastResponse
  );
}

export async function sendIotaFromBackend({
  recipientWallet,
  amountNanoIota,
  reason = "pool_refund",
}) {
  if (!recipientWallet) {
    throw createHttpError("recipientWallet is required", 400);
  }

  const amount = BigInt(amountNanoIota || 0);
  if (amount <= 0n) {
    throw createHttpError("amountNanoIota must be > 0", 400);
  }

  assertSignerReady();

  let response;
  try {
    const tx = new Transaction();
    tx.setGasBudget(IOTA_GAS_BUDGET);
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    tx.transferObjects([coin], recipientWallet);

    response = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: {
        showEffects: true,
        showBalanceChanges: true,
      },
    });
  } catch (cause) {
    throw createHttpError(
      `Failed to send IOTA refund transaction to ${recipientWallet}`,
      502,
      cause
    );
  }

  if (!response?.digest) {
    throw createHttpError("IOTA refund transaction did not return a digest", 502);
  }

  const txStatus = response.effects?.status?.status;
  if (txStatus !== "success") {
    throw createHttpError(
      `Refund transaction failed: ${response.effects?.status?.error || "unknown error"}`,
      502
    );
  }

  return {
    mode: "live",
    txDigest: response.digest,
    amountNanoIota: amount.toString(),
    recipientWallet: toNormalizedAddress(recipientWallet),
    reason,
    timestampMs: Number(response.timestampMs || Date.now()),
  };
}
