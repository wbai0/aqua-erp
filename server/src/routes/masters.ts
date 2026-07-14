import { Router } from "express";
import { prisma } from "../prisma";
import { DOC_TYPES } from "../lib/docTypes";

export const mastersRouter = Router();

mastersRouter.get("/meta", async (_req, res) => {
  const [warehouses, suppliers, customers, materials, lines] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { id: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.material.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.documentLine.findMany({ select: { origin: true, packaging: true }, distinct: ["origin", "packaging"] }),
  ]);
  const origins = [...new Set(lines.map((l) => l.origin).filter(Boolean))] as string[];
  const packagings = [...new Set(lines.map((l) => l.packaging).filter(Boolean))] as string[];
  res.json({
    capabilities: { canWriteDocs: true },
    warehouses,
    suppliers,
    customers,
    materials,
    docTypes: Object.entries(DOC_TYPES).map(([key, v]) => ({
      key,
      label: v.label,
      direction: v.direction,
      group: key === "GAIN" || key === "LOSS" ? "stocktake" : v.direction > 0 ? "in" : "out",
      needsSupplier: key === "PURCHASE_IN",
      needsCustomer: key === "SALES_OUT",
    })),
    origins: origins.map((o) => ({ id: o, name: o })),
    packagings: packagings.map((p) => ({ id: p, name: p })),
    units: ["千克", "袋", "箱", "桶", "吨", "个"].map((u) => ({ id: u, name: u })),
  });
});

// 本地模式: 产地/包装物没有独立主数据表, 直接回显 (随单据明细保存)
mastersRouter.post("/origins", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  res.status(201).json({ id: name, name });
});
mastersRouter.post("/packagings", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  res.status(201).json({ id: name, name });
});

mastersRouter.post("/suppliers", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const s = await prisma.supplier.upsert({
    where: { name },
    update: { active: true },
    create: { name },
  });
  res.json(s);
});

mastersRouter.post("/customers", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const c = await prisma.customer.upsert({
    where: { name },
    update: { active: true },
    create: { name },
  });
  res.json(c);
});

mastersRouter.post("/materials", async (req, res) => {
  const { code, name, category, unit, packaging } = req.body ?? {};
  if (!code || !name || !category || !unit) {
    return res.status(400).json({ error: "编码/品名/类别/单位不能为空" });
  }
  if (!["RAW", "SEMI", "FINISHED"].includes(category)) {
    return res.status(400).json({ error: "类别必须是 RAW/SEMI/FINISHED" });
  }
  const m = await prisma.material.upsert({
    where: { code },
    update: { name, category, unit, packaging: packaging ?? null, active: true },
    create: { code, name, category, unit, packaging: packaging ?? null },
  });
  res.json(m);
});
