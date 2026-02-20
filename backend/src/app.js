import express from "express";
import cors from "cors";
import { NANOS_PER_IOTA } from "@iota/iota-sdk/utils";
import {
  ADMIN_WALLET,
  CORS_ORIGIN,
  USE_IOTA_ESCROW,
  IOTA_NETWORKS,
  getIotaProfilesStatus,
  IOTA_NOTARIZATION_PROVIDER,
  REQUIRE_ONCHAIN_CONTRIBUTION,
  CONTRIBUTION_PRICE_NANOS,
  CONTRIBUTION_RECIPIENT_WALLET,
  normalizeIotaNetwork,
} from "./config.js";
import { readStore } from "./db.js";
import {
  getActiveIotaNetwork,
  getBackendSignerAddress,
  getIotaRuntimeInfo,
  setActiveIotaNetwork,
} from "./iotaClient.js";
import { extractWallet, getUserRoles } from "./roles.js";
import legacyMarketplaceRouter from "./routes/legacyMarketplace.js";
import propertiesRouter from "./routes/properties.js";
import hardwareRouter from "./routes/hardware.js";
import tokensRouter from "./routes/tokens.js";
import poolsRouter from "./routes/pools.js";
import computeRouter from "./routes/compute.js";

function formatRatio(numerator, denominator, maxDecimals = 6) {
  if (denominator <= 0n) {
    return null;
  }

  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || maxDecimals <= 0) {
    return whole.toString();
  }

  const scale = 10n ** BigInt(maxDecimals);
  const fractional = ((remainder * scale) / denominator).toString().padStart(maxDecimals, "0");
  const trimmed = fractional.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export function createApp() {
  const app = express();

  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json());
  app.use(extractWallet);

  // Attach the persisted store once per request.
  app.use(async (req, _res, next) => {
    try {
      req.store = await readStore();
      const selectedNetwork = normalizeIotaNetwork(
        req.store?.runtimeConfig?.activeIotaNetwork
      );
      setActiveIotaNetwork(selectedNetwork);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/health", (req, res) => {
    const selectedNetwork = normalizeIotaNetwork(
      req.store?.runtimeConfig?.activeIotaNetwork
    );
    setActiveIotaNetwork(selectedNetwork);
    const runtime = getIotaRuntimeInfo();
    res.json({
      ok: true,
      service: "computebasin-backend",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      iotaMode: runtime.mode,
      iotaActiveNetwork: runtime.activeNetwork,
      iotaRpcUrl: runtime.rpcUrl,
      adminWallet: ADMIN_WALLET || null,
      iotaBackendSigner: getBackendSignerAddress(),
    });
  });

  app.get("/api/meta", (req, res) => {
    const selectedNetwork = normalizeIotaNetwork(
      req.store?.runtimeConfig?.activeIotaNetwork
    );
    setActiveIotaNetwork(selectedNetwork);
    const runtime = getIotaRuntimeInfo();
    const iotaPerToken = formatRatio(CONTRIBUTION_PRICE_NANOS, NANOS_PER_IOTA, 9);
    const tokensPerIota = formatRatio(NANOS_PER_IOTA, CONTRIBUTION_PRICE_NANOS, 6);
    const backendSigner = getBackendSignerAddress();
    const normalizedAdmin = (ADMIN_WALLET || "").toLowerCase();
    const normalizedSigner = (backendSigner || "").toLowerCase();
    const notarizationSignerMatchesAdmin =
      normalizedAdmin && normalizedSigner ? normalizedAdmin === normalizedSigner : null;

    res.json({
      adminWallet: ADMIN_WALLET || null,
      iotaMode: runtime.mode,
      iotaActiveNetwork: getActiveIotaNetwork(),
      iotaAvailableNetworks: IOTA_NETWORKS,
      iotaProfiles: getIotaProfilesStatus(),
      iotaRpcUrl: runtime.rpcUrl,
      iotaPackageId: runtime.packageId,
      iotaBackendSigner: backendSigner,
      notarizationProvider: IOTA_NOTARIZATION_PROVIDER,
      useIotaEscrow: USE_IOTA_ESCROW,
      iotaEscrowPackageId: runtime.escrowPackageId,
      notarizationSignerMatchesAdmin,
      onChainContributionRequired: REQUIRE_ONCHAIN_CONTRIBUTION,
      contributionPriceNanoIota: CONTRIBUTION_PRICE_NANOS.toString(),
      contributionRecipientWallet: CONTRIBUTION_RECIPIENT_WALLET || null,
      iotaPerToken,
      tokensPerIota,
    });
  });

  app.get("/api/auth/roles", async (req, res, next) => {
    try {
      const wallet = req.wallet;
      if (!wallet) {
        return res.status(400).json({ error: "Wallet address required" });
      }

      const store = req.store || (await readStore());
      const roles = getUserRoles(store, wallet);
      const profile = store.userRoles?.find((item) => item.walletAddress === wallet);

      res.json({
        walletAddress: wallet,
        roles,
        kycStatus: profile?.kycStatus || "pending",
      });
    } catch (error) {
      next(error);
    }
  });

  // Legacy marketplace API currently used by the landing page.
  app.use("/api", legacyMarketplaceRouter);

  // Role-based Phase 1 APIs.
  app.use("/api/properties", propertiesRouter);
  app.use("/api/hardware-specs", hardwareRouter);
  app.use("/api/tokens", tokensRouter);
  app.use("/api/rbac/pools", poolsRouter);
  app.use("/api/rbac/compute", computeRouter);

  app.use("/api", (req, res) => {
    res.status(404).json({
      error: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({
      error: error.message || "Unexpected error",
    });
  });

  return app;
}
