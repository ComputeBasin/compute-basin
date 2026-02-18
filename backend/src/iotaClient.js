import { randomUUID } from "node:crypto";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_TYPE_ARG, normalizeIotaAddress } from "@iota/iota-sdk/utils";
import {
  MOCK_IOTA,
  IOTA_FULLNODE_URL,
  IOTA_NETWORK,
  IOTA_PACKAGE_ID,
  IOTA_SIGNER_SECRET_KEY,
  IOTA_GAS_BUDGET,
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

function assertLiveReady() {
  if (!IOTA_PACKAGE_ID) {
    throw new Error("IOTA_PACKAGE_ID is required when MOCK_IOTA=false");
  }

  if (!signer) {
    throw new Error("IOTA_SIGNER_SECRET_KEY is required when MOCK_IOTA=false");
  }
}

function assertSignerReady() {
  if (!signer) {
    throw new Error("IOTA_SIGNER_SECRET_KEY is required for backend-signed IOTA transfers");
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

  try {
    return normalizeIotaAddress(value);
  } catch {
    return value.toLowerCase();
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

export async function createNotarizationOnIota(payload) {
  if (MOCK_IOTA) {
    return {
      mode: "mock",
      objectId: fakeDigest(),
      txDigest: fakeDigest(),
      timestampMs: Date.now(),
      payload,
    };
  }

  assertLiveReady();

  if (!payload.siteObjectId) {
    throw new Error(`Missing iotaSiteObjectId for site ${payload.siteId}`);
  }

  const timestampMs = payload.timestampMs ?? Date.now();
  const hashBytes = hexToBytes(payload.fileHash);

  const tx = new Transaction();
  tx.setGasBudget(IOTA_GAS_BUDGET);
  tx.moveCall({
    target: `${IOTA_PACKAGE_ID}::passport::notarize_document`,
    arguments: [
      tx.object(payload.siteObjectId),
      tx.pure.string(payload.docType),
      tx.pure.vector("u8", Array.from(hashBytes)),
      tx.pure.u64(BigInt(timestampMs)),
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
    objectId: parseCreatedObjectId(response, "DocProof") || fakeDigest(),
    txDigest: response.digest,
    timestampMs: Number(response.timestampMs || timestampMs),
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

  assertLiveReady();

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
    throw createHttpError(
      `Unable to fetch payment transaction ${txDigest} from IOTA RPC`,
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
      `Payment transaction ${txDigest} failed: ${response.effects?.status?.error || "unknown error"}`,
      400
    );
  }

  const sender = toNormalizedAddress(response.transaction?.data?.sender || "");
  if (!sender) {
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

  if (observedAmountNanoIota < minAmount) {
    throw createHttpError(
      `Payment transaction ${txDigest} sent ${observedAmountNanoIota.toString()} nanoIOTA to treasury, expected at least ${minAmount.toString()}`,
      400
    );
  }

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
