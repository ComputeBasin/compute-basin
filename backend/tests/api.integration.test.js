import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ADMIN_WALLET =
  "0xfa95e1ddd02e752e157152ab69c0f94cbd46059133011c4edcadc99b8da640e2";
const SRL_WALLET = "0x1111111111111111111111111111111111111111111111111111111111111111";
const INVESTOR_WALLET =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

process.env.ADMIN_WALLET = ADMIN_WALLET;
process.env.MOCK_IOTA = "true";
process.env.USE_IOTA_ESCROW = "false";
process.env.IOTA_ESCROW_PACKAGE_ID = "";
process.env.REQUIRE_ONCHAIN_CONTRIBUTION = "false";
process.env.IOTA_NETWORK = "testnet";

function makeStore() {
  return {
    sites: [
      {
        id: "SITE-001",
        name: "North Grid Campus",
        siteType: "Land",
        areaM2: 24000,
        targetKw: 1200,
        approxLocation: "Nord Italia - Lombardia",
        owner: SRL_WALLET,
        computeReady: true,
        status: "seed",
        tags: ["Cooling-ready", "PV-ready"],
        iotaSiteObjectId: "0xabc123",
      },
    ],
    pools: [],
    proofs: [],
    contributions: [],
    walletBalances: {},
    walletLockedBalances: {},
    computeOffers: [],
    rentals: [],
    properties: [],
    hardwareSpecs: [],
    userRoles: [
      {
        walletAddress: ADMIN_WALLET,
        roles: ["admin"],
        kycStatus: "verified",
        createdAtMs: Date.now(),
      },
      {
        walletAddress: SRL_WALLET,
        roles: ["srl"],
        kycStatus: "verified",
        createdAtMs: Date.now(),
      },
      {
        walletAddress: INVESTOR_WALLET,
        roles: ["investor", "compute_user"],
        kycStatus: "verified",
        createdAtMs: Date.now(),
      },
    ],
    assetTokens: [],
    tokenAllocations: [],
    userProfiles: [],
    rbacPools: [],
    rbacComputeOffers: [],
    rbacRentals: [],
  };
}

async function startServer(initialStore) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "computebasin-test-"));
  const storePath = path.join(tempDir, "store.json");
  await writeFile(storePath, JSON.stringify(initialStore, null, 2), "utf8");

  process.env.STORE_PATH = storePath;

  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to obtain test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    storePath,
    async readStore() {
      const raw = await readFile(storePath, "utf8");
      return JSON.parse(raw);
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function request(baseUrl, pathName, { wallet, method = "GET", body } = {}) {
  const headers = {};
  if (wallet) {
    headers["x-wallet-address"] = wallet;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json();
  return { status: response.status, payload };
}

test("health, meta and auth roles expose expected contract", async () => {
  const server = await startServer(makeStore());
  try {
    const health = await request(server.baseUrl, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.payload.ok, true);
    assert.equal(health.payload.service, "computebasin-backend");
    assert.equal(health.payload.adminWallet, ADMIN_WALLET);

    const meta = await request(server.baseUrl, "/api/meta");
    assert.equal(meta.status, 200);
    assert.equal(meta.payload.adminWallet, ADMIN_WALLET);
    assert.equal(meta.payload.iotaMode, "mock");
    assert.equal(meta.payload.iotaActiveNetwork, "testnet");
    assert.deepEqual(meta.payload.iotaAvailableNetworks, [
      "mock",
      "localnet",
      "testnet",
      "mainnet",
    ]);
    assert.equal(meta.payload.iotaBackendSigner, null);
    assert.equal(meta.payload.notarizationProvider, "passport");
    assert.equal(meta.payload.useIotaEscrow, false);
    assert.equal(meta.payload.iotaEscrowPackageId, null);
    assert.equal(meta.payload.notarizationSignerMatchesAdmin, null);
    assert.equal(meta.payload.onChainContributionRequired, false);
    assert.equal(meta.payload.contributionPriceNanoIota, "1000000");
    assert.equal(meta.payload.contributionRecipientWallet, ADMIN_WALLET);
    assert.equal(meta.payload.iotaPerToken, "0.001");
    assert.equal(meta.payload.tokensPerIota, "1000");

    const roles = await request(server.baseUrl, "/api/auth/roles", {
      wallet: SRL_WALLET,
    });
    assert.equal(roles.status, 200);
    assert.equal(roles.payload.walletAddress, SRL_WALLET);
    assert.deepEqual(roles.payload.roles, ["srl"]);
    assert.equal(roles.payload.kycStatus, "verified");
  } finally {
    await server.close();
  }
});

test("Legacy admin can switch active IOTA network from dashboard endpoint", async () => {
  const server = await startServer(makeStore());
  try {
    const forbidden = await request(server.baseUrl, "/api/admin/iota/network", {
      method: "POST",
      wallet: INVESTOR_WALLET,
      body: { network: "localnet" },
    });
    assert.equal(forbidden.status, 403);

    const switched = await request(server.baseUrl, "/api/admin/iota/network", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: { network: "localnet" },
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.payload.activeNetwork, "localnet");

    const meta = await request(server.baseUrl, "/api/meta");
    assert.equal(meta.status, 200);
    assert.equal(meta.payload.iotaActiveNetwork, "localnet");

    const switchedMock = await request(server.baseUrl, "/api/admin/iota/network", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: { network: "mock" },
    });
    assert.equal(switchedMock.status, 200);
    assert.equal(switchedMock.payload.activeNetwork, "mock");

    const metaMock = await request(server.baseUrl, "/api/meta");
    assert.equal(metaMock.status, 200);
    assert.equal(metaMock.payload.iotaActiveNetwork, "mock");
    assert.equal(metaMock.payload.iotaMode, "mock");
  } finally {
    await server.close();
  }
});

test("Legacy admin can register a site before creating pools", async () => {
  const server = await startServer(makeStore());
  try {
    const siteRes = await request(server.baseUrl, "/api/admin/sites", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        name: "South Edge Campus",
        siteType: "Warehouse",
        areaM2: 9000,
        targetKw: 450,
        approxLocation: "Sud Italia - Sicilia",
        tags: ["fiber-near", "new-build"],
      },
    });
    assert.equal(siteRes.status, 201);
    assert.equal(siteRes.payload.site.id, "SITE-002");
    assert.equal(siteRes.payload.site.name, "South Edge Campus");
    assert.ok(siteRes.payload.site.iotaSiteObjectId);
    assert.equal(siteRes.payload.site.iotaChainMode, "mock");
    assert.equal(siteRes.payload.site.iotaNotarizationProvider, "passport");

    const listSites = await request(server.baseUrl, "/api/sites");
    assert.equal(listSites.status, 200);
    assert.equal(listSites.payload.sites.length, 2);
  } finally {
    await server.close();
  }
});

test("Legacy pool creation notarizes uploaded docs in one batch transaction", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "Batch Notarization Pool",
        description: "Batch tx notarization check",
        location: "Lombardia",
        landValueTokens: 10,
        surplusTokens: 5,
        documents: [
          {
            name: "Doc A",
            docType: "title_deed",
            driveUrl: "https://example.com/a",
          },
          {
            name: "Doc B",
            docType: "cost_sheet",
            driveUrl: "https://example.com/b",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);
    const poolId = createPoolRes.payload.pool.id;

    const poolDetails = await request(server.baseUrl, `/api/pools/${poolId}`);
    assert.equal(poolDetails.status, 200);
    assert.equal(poolDetails.payload.proofs.length, 2);

    const [proofA, proofB] = poolDetails.payload.proofs;
    assert.ok(proofA.iotaTxDigest);
    assert.equal(proofA.iotaTxDigest, proofB.iotaTxDigest);
    assert.equal(proofA.notarizationProvider, "passport");
    assert.equal(proofB.notarizationProvider, "passport");
  } finally {
    await server.close();
  }
});

test("Legacy admin can finalize additional pool documents in one batch transaction", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "Finalize Docs Pool",
        description: "Finalize docs flow",
        location: "Piemonte",
        landValueTokens: 50,
        surplusTokens: 10,
        documents: [
          {
            name: "Seed Doc",
            docType: "title_deed",
            driveUrl: "https://example.com/seed",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);
    const poolId = createPoolRes.payload.pool.id;

    const finalizeRes = await request(
      server.baseUrl,
      `/api/admin/pools/${poolId}/documents/finalize`,
      {
        method: "POST",
        wallet: ADMIN_WALLET,
        body: {
          documents: [
            {
              name: "Electrical Layout",
              docType: "electrical_layout",
              driveUrl: "https://example.com/electrical",
            },
            {
              name: "Maintenance Plan",
              docType: "maintenance_plan",
              driveUrl: "https://example.com/maintenance",
            },
          ],
        },
      }
    );
    assert.equal(finalizeRes.status, 201);
    assert.equal(finalizeRes.payload.proofs.length, 2);
    assert.equal(
      finalizeRes.payload.proofs[0].iotaTxDigest,
      finalizeRes.payload.proofs[1].iotaTxDigest
    );
    assert.equal(finalizeRes.payload.notarization.provider, "passport");

    const poolDetails = await request(server.baseUrl, `/api/pools/${poolId}`);
    assert.equal(poolDetails.status, 200);
    assert.equal(poolDetails.payload.proofs.length, 3);
  } finally {
    await server.close();
  }
});

test("Proof hash verification validates SHA-256 format", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "Hash Validation Pool",
        description: "hash validation",
        location: "Lombardia",
        landValueTokens: 20,
        surplusTokens: 10,
        documents: [
          {
            name: "Title deed",
            docType: "title_deed",
            driveUrl: "https://example.com/title",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);
    const poolId = createPoolRes.payload.pool.id;

    const poolDetails = await request(server.baseUrl, `/api/pools/${poolId}`);
    const proofId = poolDetails.payload.proofs[0].id;

    const invalidHashRes = await request(
      server.baseUrl,
      `/api/proofs/${proofId}/verify-hash`,
      {
        method: "POST",
        body: {
          docHashSha256: "abc123",
        },
      }
    );
    assert.equal(invalidHashRes.status, 400);
    assert.match(invalidHashRes.payload.error, /64-char SHA-256 hex string/);
  } finally {
    await server.close();
  }
});

test("RBAC permissions enforce admin-only token creation", async () => {
  const server = await startServer(makeStore());
  try {
    const forbidden = await request(server.baseUrl, "/api/tokens", {
      method: "POST",
      wallet: SRL_WALLET,
      body: {},
    });
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.payload.error, /Admin role required/);

    const adminValidation = await request(server.baseUrl, "/api/tokens", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {},
    });
    assert.equal(adminValidation.status, 400);
    assert.match(adminValidation.payload.error, /Missing required fields/);
  } finally {
    await server.close();
  }
});

test("RBAC flow: property -> token -> fundraising pool (isolated from legacy pools)", async () => {
  const server = await startServer(makeStore());
  try {
    const propertyRes = await request(server.baseUrl, "/api/properties", {
      method: "POST",
      wallet: SRL_WALLET,
      body: {
        name: "Capannone Milano Nord",
        location: {
          address: "Via Test 1",
          city: "Milano",
          region: "Lombardia",
          country: "IT",
        },
        specs: {
          areaM2: 1000,
          buildingType: "capannone",
          fiberAccess: true,
          accessibility: "easy",
        },
      },
    });
    assert.equal(propertyRes.status, 201);
    const propertyId = propertyRes.payload.property.id;
    assert.ok(propertyId);

    const tokenRes = await request(server.baseUrl, "/api/tokens", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        propertyId,
        name: "Milano North Pool Token",
        symbol: "MNP",
        totalSupply: "1000000",
      },
    });
    assert.equal(tokenRes.status, 201);
    const tokenId = tokenRes.payload.token.id;

    const poolRes = await request(server.baseUrl, "/api/rbac/pools", {
      method: "POST",
      wallet: SRL_WALLET,
      body: {
        propertyId,
        tokenId,
        title: "Milano North Fundraising",
        description: "Phase 1 fundraising pool",
        fundingGoal: "50000",
        investorAllocation: 60,
        maintenanceAllocation: 20,
        insuranceAllocation: 10,
        platformFeeAllocation: 10,
      },
    });
    assert.equal(poolRes.status, 201);
    assert.equal(poolRes.payload.pool.phase, "phase1_fundraising");

    const rbacPools = await request(server.baseUrl, "/api/rbac/pools");
    assert.equal(rbacPools.status, 200);
    assert.equal(rbacPools.payload.total, 1);

    const legacyPools = await request(server.baseUrl, "/api/pools");
    assert.equal(legacyPools.status, 200);
    assert.equal(legacyPools.payload.pools.length, 0);
  } finally {
    await server.close();
  }
});

test("Legacy flow: fundraising -> acquisition doc -> compute offer -> rent", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "North Grid Seed Pool",
        description: "Legacy fundraising flow",
        location: "Lombardia",
        landValueTokens: 40,
        surplusTokens: 10,
        documents: [
          {
            name: "Land deed",
            docType: "title_deed",
            driveUrl: "https://example.com/deed",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);

    const listPools = await request(server.baseUrl, "/api/pools");
    assert.equal(listPools.status, 200);
    assert.equal(listPools.payload.pools.length, 1);
    const legacyPool = listPools.payload.pools[0];
    assert.equal(legacyPool.status, "open");

    const contributeRes = await request(
      server.baseUrl,
      `/api/pools/${legacyPool.id}/contribute`,
      {
        method: "POST",
        wallet: INVESTOR_WALLET,
        body: { tokenAmount: 50 },
      }
    );
    assert.equal(contributeRes.status, 201);
    assert.equal(contributeRes.payload.walletBalance, 50);
    assert.equal(contributeRes.payload.lockedWalletBalance, 0);
    assert.equal(contributeRes.payload.pool.status, "funded");

    const acquisitionRes = await request(
      server.baseUrl,
      `/api/admin/pools/${legacyPool.id}/acquisition-doc`,
      {
        method: "POST",
        wallet: ADMIN_WALLET,
        body: {
          name: "Acquisition deed",
          driveUrl: "https://example.com/acquisition",
        },
      }
    );
    assert.equal(acquisitionRes.status, 201);
    assert.equal(acquisitionRes.payload.pool.status, "acquired");

    const offerRes = await request(
      server.baseUrl,
      `/api/admin/pools/${legacyPool.id}/compute-offer`,
      {
        method: "POST",
        wallet: ADMIN_WALLET,
        body: {
          region: "Lombardia",
          hardware: {
            gpuModel: "RTX 4090",
            gpuCount: 4,
            ramGb: 256,
            storageType: "NVMe",
            storageTb: 20,
          },
          totalUnits: 10,
          tokensPerUnitHour: 1,
          documents: [],
        },
      }
    );
    assert.equal(offerRes.status, 201);
    const offerId = offerRes.payload.computeOffer.id;

    const rentRes = await request(server.baseUrl, "/api/compute/rent", {
      method: "POST",
      wallet: INVESTOR_WALLET,
      body: {
        offerId,
        units: 2,
        hours: 5,
      },
    });
    assert.equal(rentRes.status, 201);
    assert.equal(rentRes.payload.walletBalance, 40);

    const walletSummary = await request(
      server.baseUrl,
      `/api/wallets/${INVESTOR_WALLET}/summary`
    );
    assert.equal(walletSummary.status, 200);
    assert.equal(walletSummary.payload.contributions.length, 1);
    assert.equal(walletSummary.payload.rentals.length, 1);
    assert.equal(walletSummary.payload.tokenBalance, 40);
    assert.equal(walletSummary.payload.lockedTokenBalance, 0);

    const offers = await request(server.baseUrl, "/api/compute/offers");
    assert.equal(offers.status, 200);
    assert.equal(offers.payload.offers.length, 1);
    assert.equal(offers.payload.offers[0].availableUnits, 8);
  } finally {
    await server.close();
  }
});

test("Legacy flow: failed pool allows contributor refund after deadline", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "Refundable Pool",
        description: "Deadline-based fundraising",
        location: "Lombardia",
        landValueTokens: 100,
        surplusTokens: 0,
        fundingDeadlineMs: Date.now() + 150,
        documents: [
          {
            name: "Land deed",
            docType: "title_deed",
            driveUrl: "https://example.com/deed",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);
    const poolId = createPoolRes.payload.pool.id;

    const contributeRes = await request(server.baseUrl, `/api/pools/${poolId}/contribute`, {
      method: "POST",
      wallet: INVESTOR_WALLET,
      body: { tokenAmount: 20 },
    });
    assert.equal(contributeRes.status, 201);
    assert.equal(contributeRes.payload.walletBalance, 0);
    assert.equal(contributeRes.payload.lockedWalletBalance, 20);

    await new Promise((resolve) => setTimeout(resolve, 250));

    const refundRes = await request(server.baseUrl, `/api/pools/${poolId}/refund`, {
      method: "POST",
      wallet: INVESTOR_WALLET,
      body: {},
    });
    assert.equal(refundRes.status, 201);
    assert.equal(refundRes.payload.pool.status, "failed");
    assert.equal(refundRes.payload.refundedTokenAmount, 20);
    assert.equal(refundRes.payload.walletBalance, 0);
    assert.equal(refundRes.payload.lockedWalletBalance, 0);

    const walletSummary = await request(
      server.baseUrl,
      `/api/wallets/${INVESTOR_WALLET}/summary`
    );
    assert.equal(walletSummary.status, 200);
    assert.equal(walletSummary.payload.tokenBalance, 0);
    assert.equal(walletSummary.payload.lockedTokenBalance, 0);
    assert.equal(walletSummary.payload.contributions.length, 1);
    assert.ok(walletSummary.payload.contributions[0].refundedAtMs);
  } finally {
    await server.close();
  }
});

test("Legacy flow: expired rental releases compute capacity automatically", async () => {
  const server = await startServer(makeStore());
  try {
    const createPoolRes = await request(server.baseUrl, "/api/admin/pools", {
      method: "POST",
      wallet: ADMIN_WALLET,
      body: {
        siteId: "SITE-001",
        title: "Auto-release Pool",
        description: "Rental capacity release flow",
        location: "Lombardia",
        landValueTokens: 40,
        surplusTokens: 10,
        documents: [
          {
            name: "Land deed",
            docType: "title_deed",
            driveUrl: "https://example.com/deed",
          },
        ],
      },
    });
    assert.equal(createPoolRes.status, 201);

    const listPools = await request(server.baseUrl, "/api/pools");
    assert.equal(listPools.status, 200);
    const legacyPool = listPools.payload.pools[0];

    const contributeRes = await request(
      server.baseUrl,
      `/api/pools/${legacyPool.id}/contribute`,
      {
        method: "POST",
        wallet: INVESTOR_WALLET,
        body: { tokenAmount: 50 },
      }
    );
    assert.equal(contributeRes.status, 201);

    const acquisitionRes = await request(
      server.baseUrl,
      `/api/admin/pools/${legacyPool.id}/acquisition-doc`,
      {
        method: "POST",
        wallet: ADMIN_WALLET,
        body: {
          name: "Acquisition deed",
          driveUrl: "https://example.com/acquisition",
        },
      }
    );
    assert.equal(acquisitionRes.status, 201);

    const offerRes = await request(
      server.baseUrl,
      `/api/admin/pools/${legacyPool.id}/compute-offer`,
      {
        method: "POST",
        wallet: ADMIN_WALLET,
        body: {
          region: "Lombardia",
          hardware: {
            gpuModel: "RTX 4090",
            gpuCount: 4,
            ramGb: 256,
            storageType: "NVMe",
            storageTb: 20,
          },
          totalUnits: 10,
          tokensPerUnitHour: 1,
          documents: [],
        },
      }
    );
    assert.equal(offerRes.status, 201);
    const offerId = offerRes.payload.computeOffer.id;

    const rentRes = await request(server.baseUrl, "/api/compute/rent", {
      method: "POST",
      wallet: INVESTOR_WALLET,
      body: {
        offerId,
        units: 2,
        hours: 0.00001,
      },
    });
    assert.equal(rentRes.status, 201);
    assert.equal(rentRes.payload.availableUnits, 8);
    assert.ok(rentRes.payload.rental.endAtMs > rentRes.payload.rental.startAtMs);

    await new Promise((resolve) => setTimeout(resolve, 120));

    const offersAfterExpiry = await request(server.baseUrl, "/api/compute/offers");
    assert.equal(offersAfterExpiry.status, 200);
    assert.equal(offersAfterExpiry.payload.offers[0].availableUnits, 10);

    const walletSummary = await request(
      server.baseUrl,
      `/api/wallets/${INVESTOR_WALLET}/summary`
    );
    assert.equal(walletSummary.status, 200);
    assert.equal(walletSummary.payload.rentals[0].status, "completed");
    assert.ok(walletSummary.payload.rentals[0].completedAtMs);
  } finally {
    await server.close();
  }
});
