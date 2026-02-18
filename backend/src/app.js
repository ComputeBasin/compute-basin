import express from "express";
import cors from "cors";
import { ADMIN_WALLET, CORS_ORIGIN, MOCK_IOTA } from "./config.js";
import { readStore } from "./db.js";
import { getBackendSignerAddress } from "./iotaClient.js";
import { extractWallet, getUserRoles } from "./roles.js";
import legacyMarketplaceRouter from "./routes/legacyMarketplace.js";
import propertiesRouter from "./routes/properties.js";
import hardwareRouter from "./routes/hardware.js";
import tokensRouter from "./routes/tokens.js";
import poolsRouter from "./routes/pools.js";
import computeRouter from "./routes/compute.js";

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
    res.json({
      adminWallet: ADMIN_WALLET || null,
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

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({
      error: error.message || "Unexpected error",
    });
  });

  return app;
}
