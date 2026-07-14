import { Router } from "express";
import { computeStock } from "../lib/inventory";

export const inventoryRouter = Router();

// 即时库存 / 即时库存-按批次
inventoryRouter.get("/", async (req, res) => {
  const q = req.query;
  const rows = await computeStock({
    warehouseId: q.warehouseId ? Number(q.warehouseId) : undefined,
    materialId: q.materialId ? Number(q.materialId) : undefined,
    category: q.category ? String(q.category) : undefined,
    byBatch: q.byBatch === "1" || q.byBatch === "true",
  });
  res.json({ rows });
});
