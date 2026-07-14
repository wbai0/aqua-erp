import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { DOC_TYPES, isDocType } from "../lib/docTypes";
import { checkSufficientStock } from "../lib/inventory";

export const documentsRouter = Router();

const lineSchema = z.object({
  materialId: z.number().int(),
  batchNo: z.string().nullish(),
  retrievalCode: z.string().nullish(),
  origin: z.string().nullish(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  weight: z.number().nullish(),
  packaging: z.string().nullish(),
  note: z.string().nullish(),
});

const docSchema = z.object({
  docType: z.string().refine(isDocType, "无效的单据类型"),
  date: z.string(), // ISO date
  warehouseId: z.number().int(),
  supplierId: z.number().int().nullish(),
  customerId: z.number().int().nullish(),
  vehicleNo: z.string().nullish(),
  remark: z.string().nullish(),
  lines: z.array(lineSchema).min(1, "至少需要一行明细"),
});

async function nextDocNo(docType: string): Promise<string> {
  const prefix = isDocType(docType) ? DOC_TYPES[docType].prefix : "DOC";
  const counter = await prisma.docCounter.upsert({
    where: { docType },
    update: { seq: { increment: 1 } },
    create: { docType, seq: 1000001 },
  });
  return `${prefix}${String(counter.seq).padStart(10, "0")}`;
}

// 列表 + 筛选
documentsRouter.get("/", async (req, res) => {
  const q = req.query;
  const docTypes = typeof q.docType === "string" ? q.docType.split(",").filter(Boolean) : undefined;
  const where: any = {};
  if (docTypes?.length) where.docType = { in: docTypes };
  if (q.status) where.status = String(q.status);
  if (q.warehouseId) where.warehouseId = Number(q.warehouseId);
  if (q.supplierId) where.supplierId = Number(q.supplierId);
  if (q.customerId) where.customerId = Number(q.customerId);
  if (q.vehicleNo) where.vehicleNo = { contains: String(q.vehicleNo) };
  if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = new Date(String(q.dateFrom));
    if (q.dateTo) where.date.lte = new Date(String(q.dateTo) + "T23:59:59");
  }
  if (q.materialId || q.retrievalCode) {
    where.lines = {
      some: {
        ...(q.materialId ? { materialId: Number(q.materialId) } : {}),
        ...(q.retrievalCode ? { retrievalCode: { contains: String(q.retrievalCode) } } : {}),
      },
    };
  }
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Number(q.pageSize) || 50);

  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      include: {
        warehouse: true,
        supplier: true,
        customer: true,
        createdBy: { select: { displayName: true } },
        lines: { include: { material: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  res.json({ total, page, pageSize, items });
});

documentsRouter.get("/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      warehouse: true,
      supplier: true,
      customer: true,
      createdBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      lines: { include: { material: true } },
    },
  });
  if (!doc) return res.status(404).json({ error: "单据不存在" });
  res.json(doc);
});

// 新单
documentsRouter.post("/", async (req, res) => {
  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "参数错误" });
  }
  const d = parsed.data;
  const docNo = await nextDocNo(d.docType);
  const doc = await prisma.document.create({
    data: {
      docNo,
      docType: d.docType,
      date: new Date(d.date),
      warehouseId: d.warehouseId,
      supplierId: d.supplierId ?? null,
      customerId: d.customerId ?? null,
      vehicleNo: d.vehicleNo ?? null,
      remark: d.remark ?? null,
      createdById: req.user!.id,
      lines: {
        create: d.lines.map((l) => ({
          materialId: l.materialId,
          batchNo: l.batchNo ?? null,
          retrievalCode: l.retrievalCode ?? null,
          origin: l.origin ?? null,
          quantity: l.quantity,
          unit: l.unit,
          weight: l.weight ?? null,
          packaging: l.packaging ?? null,
          note: l.note ?? null,
        })),
      },
    },
    include: { lines: true },
  });
  res.status(201).json(doc);
});

// 修改 (仅草稿)
documentsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "单据不存在" });
  if (existing.status !== "DRAFT") return res.status(409).json({ error: "已审核单据不能修改，请先取消审核" });

  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "参数错误" });
  }
  const d = parsed.data;
  const doc = await prisma.$transaction(async (tx) => {
    await tx.documentLine.deleteMany({ where: { documentId: id } });
    return tx.document.update({
      where: { id },
      data: {
        date: new Date(d.date),
        warehouseId: d.warehouseId,
        supplierId: d.supplierId ?? null,
        customerId: d.customerId ?? null,
        vehicleNo: d.vehicleNo ?? null,
        remark: d.remark ?? null,
        lines: {
          create: d.lines.map((l) => ({
            materialId: l.materialId,
            batchNo: l.batchNo ?? null,
            retrievalCode: l.retrievalCode ?? null,
            origin: l.origin ?? null,
            quantity: l.quantity,
            unit: l.unit,
            weight: l.weight ?? null,
            packaging: l.packaging ?? null,
            note: l.note ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  });
  res.json(doc);
});

// 删除 (仅草稿)
documentsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "单据不存在" });
  if (existing.status !== "DRAFT") return res.status(409).json({ error: "已审核单据不能删除，请先取消审核" });
  await prisma.document.delete({ where: { id } });
  res.json({ ok: true });
});

// 审核
documentsRouter.post("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "单据不存在" });
  if (existing.status === "APPROVED") return res.status(409).json({ error: "单据已审核" });

  const shortages = await checkSufficientStock(id);
  if (shortages.length) {
    return res.status(409).json({ error: `库存不足: ${shortages.join("; ")}` });
  }

  const doc = await prisma.document.update({
    where: { id },
    data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
  });
  res.json(doc);
});

// 取消审核
documentsRouter.post("/:id/unapprove", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "单据不存在" });
  if (existing.status !== "APPROVED") return res.status(409).json({ error: "单据未审核" });

  const doc = await prisma.document.update({
    where: { id },
    data: { status: "DRAFT", approvedById: null, approvedAt: null },
  });
  res.json(doc);
});
