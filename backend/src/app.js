import express from "express";
import cors from "cors";
import { NANOS_PER_IOTA } from "@iota/iota-sdk/utils";
import {
  ADMIN_WALLET,
  CORS_ORIGIN,
  MOCK_IOTA,
  REQUIRE_ONCHAIN_CONTRIBUTION,
  CONTRIBUTION_PRICE_NANOS,
  CONTRIBUTION_RECIPIENT_WALLET,
} from "./config.js";
import { readStore } from "./db.js";
import { getBackendSignerAddress } from "./iotaClient.js";
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
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "computebasin-backend",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      iotaMode: MOCK_IOTA ? "mock" : "live",
      adminWallet: ADMIN_WALLET || null,
      iotaBackendSigner: getBackendSignerAddress(),
    });
  });

  app.get("/api/meta", (_req, res) => {
    const iotaPerToken = formatRatio(CONTRIBUTION_PRICE_NANOS, NANOS_PER_IOTA, 9);
    const tokensPerIota = formatRatio(NANOS_PER_IOTA, CONTRIBUTION_PRICE_NANOS, 6);

    res.json({
      adminWallet: ADMIN_WALLET || null,
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
