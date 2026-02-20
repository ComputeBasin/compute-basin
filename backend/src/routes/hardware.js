import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../db.js";
import { requireRoles, checkPermission } from "../roles.js";

const router = Router();

/**
 * Get all hardware specification templates
 * Public read access - anyone can view available hardware specs
 * Query params:
 *   - propertyId: Filter specs by linked property
 *   - type: Filter specs by hardware type (cpu, gpu, memory, storage, network)
 */
router.get("/", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { propertyId, type } = req.query;

    let specs = store.hardwareSpecs || [];

    // Filter by property if specified
    if (propertyId) {
      specs = specs.filter((spec) => spec.propertyId === propertyId);
    }

    // Filter by hardware type if specified
    if (type) {
      specs = specs.filter((spec) => spec.type === type);
    }

    res.json({
      specs,
      total: specs.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get specific hardware specification
 */
router.get("/:hardwareId", async (req, res, next) => {
  try {
    const store = req.store || (await readStore());
    const { hardwareId } = req.params;

    const spec = store.hardwareSpecs?.find((h) => h.id === hardwareId);

    if (!spec) {
      return res.status(404).json({ error: "Hardware specification not found" });
    }

    res.json({ hardware: spec });
  } catch (error) {
    next(error);
  }
});

/**
 * Create new hardware specification template
 * SRL and Admin only
 * Can be property-specific or general template
 * Required fields:
 *   - type: "cpu" | "gpu" | "memory" | "storage" | "network" | "other"
 *   - name: Human-readable specification name
 *   - specifications: Object with detailed specs (cores, ram, speed, etc)
 *   - propertyId (optional): Link to property this hardware is installed on
 *   - costPerUnit: Cost per unit of this resource
 *   - units: Unit of measurement (cores, GB, Mbps, etc)
 */
router.post(
  "/",
  requireRoles("srl", "admin"),
  checkPermission("hardware_specs", "create"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { type, name, specifications, propertyId, costPerUnit, units, description } = req.body;

      // Validate required fields
      if (!type || !name || !specifications) {
        return res.status(400).json({
          error: "Missing required fields: type, name, specifications",
        });
      }

      // Validate hardware type
      const validTypes = ["cpu", "gpu", "memory", "storage", "network", "other"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: `Invalid hardware type. Must be one of: ${validTypes.join(", ")}`,
        });
      }

      const hardwareId = randomUUID();
      const now = new Date().toISOString();

      const newSpec = {
        id: hardwareId,
        type,
        name,
        description: description || "",
        specifications,
        propertyId: propertyId || null,
        costPerUnit: costPerUnit || 0,
        units: units || "unit",
        createdBy: wallet,
        createdAt: now,
        updatedAt: now,
        status: "active",
      };

      // Ensure hardwareSpecs array exists
      if (!store.hardwareSpecs) {
        store.hardwareSpecs = [];
      }

      store.hardwareSpecs.push(newSpec);
      await writeStore(store);

      res.status(201).json({ hardware: newSpec });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Update hardware specification
 * SRL and Admin only - must be creator or admin
 */
router.put(
  "/:hardwareId",
  requireRoles("srl", "admin"),
  checkPermission("hardware_specs", "update"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { hardwareId } = req.params;
      const { name, description, specifications, costPerUnit, units, status } = req.body;

      const spec = store.hardwareSpecs?.find((h) => h.id === hardwareId);

      if (!spec) {
        return res.status(404).json({ error: "Hardware specification not found" });
      }

      // Permission check: only creator or admin can update
      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const isCreator = spec.createdBy?.toLowerCase() === wallet?.toLowerCase();

      if (!isCreator && !isAdmin) {
        return res.status(403).json({
          error: "Only the creator or an admin can update this hardware specification",
          createdBy: spec.createdBy,
        });
      }

      // Update allowed fields
      if (name !== undefined) spec.name = name;
      if (description !== undefined) spec.description = description;
      if (specifications !== undefined) spec.specifications = specifications;
      if (costPerUnit !== undefined) spec.costPerUnit = costPerUnit;
      if (units !== undefined) spec.units = units;
      if (status !== undefined && ["active", "archived", "deprecated"].includes(status)) {
        spec.status = status;
      }

      spec.updatedAt = new Date().toISOString();

      await writeStore(store);

      res.json({ hardware: spec });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Delete (archive) hardware specification
 * SRL and Admin only - must be creator or admin
 * Soft delete: marks as archived rather than permanent deletion
 */
router.delete(
  "/:hardwareId",
  requireRoles("srl", "admin"),
  checkPermission("hardware_specs", "delete"),
  async (req, res, next) => {
    try {
      const wallet = req.wallet;
      const store = req.store || (await readStore());
      const { hardwareId } = req.params;

      const spec = store.hardwareSpecs?.find((h) => h.id === hardwareId);

      if (!spec) {
        return res.status(404).json({ error: "Hardware specification not found" });
      }

      // Permission check: only creator or admin can delete
      const userRoles = req.userRoles || [];
      const isAdmin = userRoles.includes("admin");
      const isCreator = spec.createdBy?.toLowerCase() === wallet?.toLowerCase();

      if (!isCreator && !isAdmin) {
        return res.status(403).json({
          error: "Only the creator or an admin can delete this hardware specification",
          createdBy: spec.createdBy,
        });
      }

      // Soft delete - mark as archived
      spec.status = "archived";
      spec.updatedAt = new Date().toISOString();

      await writeStore(store);

      res.json({
        message: "Hardware specification archived successfully",
        hardware: spec,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
