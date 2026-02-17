import { randomUUID } from "node:crypto";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { Transaction } from "@iota/iota-sdk/transactions";
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

function parseCreatedObjectId(response, typeHint) {
  const created = response?.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      typeof change.objectType === "string" &&
      change.objectType.includes(typeHint)
  );

  return created?.objectId ?? null;
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
