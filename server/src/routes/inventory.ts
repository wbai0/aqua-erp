import { Router } from "express";
import { computeStock } from "../lib/inventory";

export const inventoryRouter = Router();

// 即时库存 / 即时库存-按批次
inventoryRouter.get("/", async (req, res) => {
  const q = req.query;
  const csv = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  const rows = await computeStock({
    warehouseIds: csv(q.warehouseIds).map(Number).filter(Number.isFinite),
    suppliers: csv(q.suppliers),
    origins: csv(q.origins),
    categories: csv(q.categories),
    q: typeof q.q === "string" ? q.q.trim() : "",
    byBatch: q.byBatch === "1" || q.byBatch === "true",
  });
  res.json({ rows });
});
