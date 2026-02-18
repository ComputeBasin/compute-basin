/**
 * Property & Asset Management Endpoints
 * Handles SRL member uploads and property management
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireRoles, checkPermission } from "../roles.js";
import { readStore, writeStore } from "../db.js";
import { sha256Hex } from "../hash.js";

const router = Router();

/**
 * GET /api/properties
 * List all active properties (public)
 */
router.get("/", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const properties = (store.properties || []).filter((p) => p.status !== "archived");

    res.json({
      properties,
      total: properties.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/properties/:propertyId
 * Get specific property details
 */
router.get("/:propertyId", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const property = store.properties?.find((p) => p.id === req.params.propertyId);

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    res.json({ property });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/properties
 * Create new property (SRL members only)
 */
router.post(
  "/",
  requireRoles("srl", "admin"),
  checkPermission("properties", "create"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;

      const {
        name,
        description,
        location,
        specs,
        documents = [],
      } = req.body;

      if (!name || !location || !specs) {
        return res.status(400).json({
          error: "name, location, and specs are required",
        });
      }

      const store = req.store || (await readStore());
      if (!store.properties) {
        store.properties = [];
      }

      const propertyId = `prop_${randomUUID()}`;

      const property = {
        id: propertyId,
        name,
        description: description || "",
        location,
        specs,
        documents: Array.isArray(documents)
          ? documents.map((doc) => ({
              ...doc,
              id: `doc_${randomUUID()}`,
              uploadedAtMs: Date.now(),
              docHashSha256: doc.docHashSha256 || sha256Hex(Buffer.from(JSON.stringify(doc))),
            }))
          : [],
        srlWalletAddress: wallet,
        status: "draft",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      store.properties.push(property);
      await writeStore(store);

      res.status(201).json({ property });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/properties/:propertyId
 * Update property (SRL owner only)
 */
router.put(
  "/:propertyId",
  requireRoles("srl", "admin"),
  checkPermission("properties", "update"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const { name, description, location, specs, status } = req.body;

      const store = req.store || (await readStore());
      const property = store.properties?.find((p) => p.id === req.params.propertyId);

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Check ownership
      if (property.srlWalletAddress !== wallet && !req.userRoles?.includes("admin")) {
        return res.status(403).json({ error: "Only owner can update this property" });
      }

      if (name) property.name = name;
      if (description) property.description = description;
      if (location) property.location = location;
      if (specs) property.specs = specs;
      if (status && ["draft", "active", "archived"].includes(status)) {
        property.status = status;
      }

      property.updatedAtMs = Date.now();

      await writeStore(store);
      res.json({ property });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/properties/:propertyId
 * Archive property (SRL owner only)
 */
router.delete(
  "/:propertyId",
  requireRoles("srl", "admin"),
  checkPermission("properties", "delete"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;

      const store = req.store || (await readStore());
      const property = store.properties?.find((p) => p.id === req.params.propertyId);

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Check ownership
      if (property.srlWalletAddress !== wallet && !req.userRoles?.includes("admin")) {
        return res.status(403).json({ error: "Only owner can delete this property" });
      }

      property.status = "archived";
      property.updatedAtMs = Date.now();

      await writeStore(store);
      res.json({ message: "Property archived", property });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
