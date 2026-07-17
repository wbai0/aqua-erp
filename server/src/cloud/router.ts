// 云端结构模式 (DATA_SOURCE=cloud)：所有读写统一使用 CLOUD_DATABASE_URL。
//
// ⚠️ 生产 SQL Server 为 2008 时代版本, 不支持 OFFSET/FETCH 分页,
// Prisma 生成的查询会报语法错误 — 因此本文件全部使用手写 SQL
// ($queryRaw, TOP / ROW_NUMBER 分页), Prisma 仅作为连接驱动.
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Prisma } from "../generated/cloud";
import { cloudPrisma as db } from "./prisma";
import { AuthUser } from "../auth";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const md5 = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const S = Prisma.sql;
const join = Prisma.join;
const empty = Prisma.empty;

// ---------- 登录: t_a_personnel (user_id + MD5 密码) ----------
export const cloudAuthRouter = Router();

cloudAuthRouter.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "用户名和密码不能为空" });
  const rows = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 personnel, user_id, user_pwd, name FROM t_a_personnel
      WHERE user_id = ${String(username).toUpperCase()} AND s_status = N'有效'`
  );
  const user = rows[0];
  if (!user || !user.user_pwd || user.user_pwd.toLowerCase() !== md5(String(password)).toLowerCase()) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  const payload: AuthUser = {
    id: 0,
    personnelId: user.personnel,
    username: user.user_id,
    displayName: user.name,
    roles: ["WAREHOUSE"],
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: payload });
});

// ---------- 工具 ----------
function groupOf(name: string, dir: 1 | -1): "in" | "out" | "stocktake" {
  if (name.includes("盘盈") || name.includes("盘亏")) return "stocktake";
  return dir > 0 ? "in" : "out";
}
const statusMap = (s: string) => (s === "已审核" ? "APPROVED" : "DRAFT");

async function unitNames(): Promise<Map<string, string>> {
  const units = await db.$queryRaw<any[]>(S`SELECT unit, unit_name FROM t_a_unit`);
  return new Map(units.map((u) => [u.unit, u.unit_name]));
}

// ---------- 基础资料 ----------
export const cloudMastersRouter = Router();

cloudMastersRouter.get("/meta", async (_req, res) => {
  const [stocks, suppliers, custs, materials, inTypes, outTypes, addrs, packings, units] =
    await Promise.all([
      db.$queryRaw<any[]>(S`SELECT stock, stock_name FROM t_a_stock ORDER BY [order]`),
      db.$queryRaw<any[]>(S`SELECT supplier, supplier_name FROM t_a_supplier ORDER BY supplier`),
      db.$queryRaw<any[]>(S`SELECT cust, cust_name FROM t_a_cust ORDER BY cust`),
      db.$queryRaw<any[]>(
        S`SELECT m.material_id, m.material_no, m.material_name, m.material_type, m.unit, u.unit_name, mt.material_type_name
          FROM t_a_material m
          LEFT JOIN t_a_unit u ON u.unit = m.unit
          LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
          WHERE m.m_status = N'有效' ORDER BY m.material_id`
      ),
      db.$queryRaw<any[]>(S`SELECT in_type, in_type_name FROM t_a_in_type`),
      db.$queryRaw<any[]>(S`SELECT out_type, out_type_name FROM t_a_out_type`),
      db.$queryRaw<any[]>(
        S`SELECT man_address, man_address_name, man_address_no FROM t_a_man_address WHERE s_status = N'有效'`
      ),
      db.$queryRaw<any[]>(S`SELECT packing, packing_name FROM t_a_packing WHERE s_status = N'有效'`),
      db.$queryRaw<any[]>(S`SELECT unit, unit_name FROM t_a_unit ORDER BY list_no`),
    ]);
  res.json({
    capabilities: { canWriteDocs: false }, // 只读模式：前端隐藏一切写操作(新单/修改/删除/审核)
    warehouses: stocks.map((s) => ({ id: s.stock, code: s.stock, name: s.stock_name })),
    suppliers: suppliers.map((s) => ({ id: s.supplier, name: s.supplier_name })),
    customers: custs.map((c) => ({ id: c.cust, name: c.cust_name })),
    materials: materials.map((m) => ({
      id: m.material_id,
      code: m.material_no ?? m.material_id,
      name: m.material_name,
      category: m.material_type,
      categoryName: m.material_type_name ?? m.material_type,
      unit: m.unit_name ?? "",
      unitId: m.unit,
      packaging: null,
    })),
    docTypes: [
      ...inTypes.map((t) => ({
        key: `IN_${t.in_type}`,
        label: t.in_type_name,
        direction: 1,
        group: groupOf(t.in_type_name, 1),
        needsSupplier: t.in_type_name.includes("采购") || t.in_type_name.includes("毛料入库"),
        needsCustomer: false,
      })),
      ...outTypes.map((t) => ({
        key: `OUT_${t.out_type}`,
        label: t.out_type_name,
        direction: -1,
        group: groupOf(t.out_type_name, -1),
        needsSupplier: false,
        needsCustomer: t.out_type_name.includes("销售"),
      })),
    ],
    origins: addrs.map((a) => ({ id: a.man_address, name: a.man_address_name, code: a.man_address_no })),
    packagings: packings.map((p) => ({ id: p.packing, name: p.packing_name })),
    units: units.map((u) => ({ id: u.unit, name: u.unit_name })),
  });
});

cloudMastersRouter.post("/suppliers", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const code = (String(req.body?.code ?? "").trim() || name).slice(0, 20);
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const exists = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 supplier, supplier_name FROM t_a_supplier WHERE supplier = ${code} OR supplier_name = ${name}`
  );
  if (exists[0]) return res.json({ id: exists[0].supplier, name: exists[0].supplier_name });
  const t = await db.$queryRaw<any[]>(S`SELECT TOP 1 supplier_type FROM t_a_supplier_type`);
  await db.$executeRaw(
    S`INSERT INTO t_a_supplier (supplier, supplier_name, supplier_type) VALUES (${code}, ${name}, ${t[0]?.supplier_type ?? "01"})`
  );
  res.status(201).json({ id: code, name });
});

cloudMastersRouter.post("/customers", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const code = (String(req.body?.code ?? "").trim() || name).slice(0, 20);
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const exists = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 cust, cust_name FROM t_a_cust WHERE cust = ${code} OR cust_name = ${name}`
  );
  if (exists[0]) return res.json({ id: exists[0].cust, name: exists[0].cust_name });
  const t = await db.$queryRaw<any[]>(S`SELECT TOP 1 cust_type FROM t_a_cust_type`);
  await db.$executeRaw(
    S`INSERT INTO t_a_cust (cust, cust_name, cust_type) VALUES (${code}, ${name}, ${t[0]?.cust_type ?? "01"})`
  );
  res.status(201).json({ id: code, name });
});

// 新增物料 (需 编码/品名/类别/单位编码)
cloudMastersRouter.post("/materials", async (req, res) => {
  const { code, name, category, unit } = req.body ?? {};
  if (!code || !name || !category || !unit) return res.status(400).json({ error: "编码/品名/类别/单位不能为空" });
  const exists = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 m.material_id, m.material_name, m.material_type, m.unit, u.unit_name
      FROM t_a_material m LEFT JOIN t_a_unit u ON u.unit = m.unit WHERE m.material_id = ${String(code)}`
  );
  if (exists[0]) {
    const m = exists[0];
    return res.json({ id: m.material_id, code: m.material_id, name: m.material_name, category: m.material_type, unit: m.unit_name ?? "", unitId: m.unit });
  }
  const type = await db.$queryRaw<any[]>(S`SELECT TOP 1 material_type FROM t_a_material_type WHERE material_type = ${String(category)}`);
  if (!type[0]) {
    await db.$executeRaw(S`INSERT INTO t_a_material_type (material_type, material_type_name, s_status) VALUES (${String(category)}, ${String(category).slice(0, 20)}, N'有效')`);
  }
  await db.$executeRaw(
    S`INSERT INTO t_a_material (material_id, material_no, material_name, material_type, unit, m_status)
      VALUES (${String(code)}, ${String(code)}, ${String(name)}, ${String(category)}, ${String(unit)}, N'有效')`
  );
  const u = await db.$queryRaw<any[]>(S`SELECT unit_name FROM t_a_unit WHERE unit = ${String(unit)}`);
  res.status(201).json({ id: code, code, name, category, unit: u[0]?.unit_name ?? "", unitId: unit });
});

cloudMastersRouter.post("/origins", async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 20);
  const code = (String(req.body?.code ?? "").trim() || name).slice(0, 20);
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const exists = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 man_address, man_address_name FROM t_a_man_address WHERE man_address = ${name} OR man_address_name = ${name}`
  );
  if (exists[0]) return res.json({ id: exists[0].man_address, name: exists[0].man_address_name });
  await db.$executeRaw(
    S`INSERT INTO t_a_man_address (man_address, man_address_name, man_address_no, s_status) VALUES (${name}, ${name}, ${code}, N'有效')`
  );
  res.status(201).json({ id: name, name });
});

cloudMastersRouter.post("/packagings", async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 20);
  if (!name) return res.status(400).json({ error: "名称不能为空" });
  const exists = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 packing, packing_name FROM t_a_packing WHERE packing = ${name} OR packing_name = ${name}`
  );
  if (exists[0]) return res.json({ id: exists[0].packing, name: exists[0].packing_name });
  await db.$executeRaw(
    S`INSERT INTO t_a_packing (packing, packing_name, s_status) VALUES (${name}, ${name}, N'有效')`
  );
  res.status(201).json({ id: name, name });
});

// ---------- 单据 (只读) ----------
export const cloudDocumentsRouter = Router();

async function fetchLines(kind: "in" | "out", ids: string[], uNames: Map<string, string>) {
  if (!ids.length) return new Map<string, any[]>();
  const rows =
    kind === "in"
      ? await db.$queryRaw<any[]>(
          S`SELECT d.in_id AS doc_id, d.in_detail AS line_id, d.material_id, d.material_no, d.material_name,
                   d.batch_no, d.s_code, d.man_address, d.quantity, d.unit, d.weight_quantity, d.weight_unit,
                   d.spec, d.pack_quantity, d.pack_unit, d.tech, d.packing, d.memo,
                   m.material_no AS m_no, m.material_name AS m_name, s.supplier_name
            FROM t_stock_in_detail d
            LEFT JOIN t_a_material m ON m.material_id = d.material_id
            LEFT JOIN t_a_supplier s ON s.supplier = d.supplier
            WHERE d.in_id IN (${join(ids)})`
        )
      : await db.$queryRaw<any[]>(
          S`SELECT d.out_id AS doc_id, d.out_detail AS line_id, d.material_id, d.material_no, d.material_name,
                   d.batch_no, d.s_code, d.man_address, d.quantity, d.unit, NULL AS weight_quantity, NULL AS weight_unit,
                   d.spec, d.pack_quantity, d.pack_unit, d.tech, d.packing, d.memo,
                   m.material_no AS m_no, m.material_name AS m_name, NULL AS supplier_name
            FROM t_stock_out_detail d
            LEFT JOIN t_a_material m ON m.material_id = d.material_id
            WHERE d.out_id IN (${join(ids)})`
        );
  const map = new Map<string, any[]>();
  for (const r of rows) {
    const line = {
      id: r.line_id,
      materialId: r.material_id,
      material: { code: r.material_no ?? r.m_no ?? r.material_id, name: r.material_name ?? r.m_name ?? "" },
      batchNo: r.batch_no,
      retrievalCode: r.s_code,
      origin: r.man_address,
      quantity: Number(r.quantity),
      unit: uNames.get(r.unit) ?? r.unit,
      unitId: r.unit,
      spec: r.spec || null,
      packQuantity: r.pack_quantity != null ? Number(r.pack_quantity) : null,
      packUnit: r.pack_unit ? (uNames.get(r.pack_unit) ?? r.pack_unit) : null,
      tech: r.tech || null,
      weight: r.weight_quantity != null ? Number(r.weight_quantity) : null,
      weightUnit: r.weight_unit ? (uNames.get(r.weight_unit) ?? r.weight_unit) : null,
      packaging: r.packing,
      note: r.memo,
      supplierName: r.supplier_name ?? null,
    };
    if (!map.has(r.doc_id)) map.set(r.doc_id, []);
    map.get(r.doc_id)!.push(line);
  }
  return map;
}

function mapHeader(kind: "in" | "out", h: any, lines: any[]) {
  return {
    id: kind === "in" ? h.in_id : h.out_id,
    docNo: kind === "in" ? h.in_id : h.out_id,
    docType: kind === "in" ? `IN_${h.in_type ?? ""}` : `OUT_${h.out_type}`,
    date: h.date_time,
    status: statusMap(h.s_status),
    warehouse: { name: h.stock_name ?? h.stock },
    supplier: lines[0]?.supplierName ? { name: lines[0].supplierName } : null,
    customer: h.cust_name ? { name: h.cust_name } : null,
    vehicleNo: (kind === "in" ? h.car_no2 : h.car_no) ?? h.batch_no,
    remark: h.memo,
    createdBy: { displayName: h.entry_name ?? h.entry_person },
    approvedBy: h.audit_person ? { displayName: h.audit_person } : null,
    lines,
  };
}

cloudDocumentsRouter.get("/", async (req, res) => {
  const q = req.query;
  const uNames = await unitNames();
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Number(q.pageSize) || 50);
  const docTypes = typeof q.docType === "string" ? q.docType.split(",").filter(Boolean) : [];
  const inCodes = docTypes.filter((t) => t.startsWith("IN_")).map((t) => t.slice(3));
  const outCodes = docTypes.filter((t) => t.startsWith("OUT_")).map((t) => t.slice(4));
  const wantIn = inCodes.length > 0 || docTypes.length === 0;
  const wantOut = outCodes.length > 0 || docTypes.length === 0;
  const statusFilter = q.status ? (q.status === "APPROVED" ? "已审核" : "未审核") : undefined;
  const from = q.dateFrom ? new Date(String(q.dateFrom)) : undefined;
  const to = q.dateTo ? new Date(String(q.dateTo) + "T23:59:59") : undefined;
  const first = (page - 1) * pageSize + 1;
  const last = page * pageSize;

  let items: any[] = [];
  let total = 0;

  if (wantIn) {
    const conds = [S`1=1`];
    if (inCodes.length) conds.push(S`h.in_type IN (${join(inCodes)})`);
    if (statusFilter) conds.push(S`h.s_status = ${statusFilter}`);
    if (from) conds.push(S`h.date_time >= ${from}`);
    if (to) conds.push(S`h.date_time <= ${to}`);
    if (q.vehicleNo) conds.push(S`h.car_no2 LIKE ${"%" + String(q.vehicleNo) + "%"}`);
    if (q.supplierId || q.materialId || q.retrievalCode) {
      const dconds = [S`d.in_id = h.in_id`];
      if (q.supplierId) dconds.push(S`d.supplier = ${String(q.supplierId)}`);
      if (q.materialId) dconds.push(S`d.material_id = ${String(q.materialId)}`);
      if (q.retrievalCode) dconds.push(S`d.s_code LIKE ${"%" + String(q.retrievalCode) + "%"}`);
      conds.push(S`EXISTS (SELECT 1 FROM t_stock_in_detail d WHERE ${join(dconds, " AND ")})`);
    }
    const where = join(conds, " AND ");
    const [cnt] = await db.$queryRaw<any[]>(S`SELECT COUNT(*) AS c FROM t_stock_in h WHERE ${where}`);
    total += Number(cnt.c);
    const rows = await db.$queryRaw<any[]>(
      S`SELECT * FROM (
          SELECT h.in_id, h.in_type, h.date_time, h.s_status, h.car_no2, h.batch_no, h.memo,
                 h.audit_person, h.entry_person, st.stock_name, c.cust_name, p.name AS entry_name,
                 ROW_NUMBER() OVER (ORDER BY h.date_time DESC, h.sequence_id DESC) AS rn
          FROM t_stock_in h
          LEFT JOIN t_a_stock st ON st.stock = h.stock
          LEFT JOIN t_a_cust c ON c.cust = h.in_cust
          LEFT JOIN t_a_personnel p ON p.personnel = h.entry_person
          WHERE ${where}
        ) x WHERE x.rn BETWEEN ${first} AND ${last} ORDER BY x.rn`
    );
    const lineMap = await fetchLines("in", rows.map((r) => r.in_id), uNames);
    items.push(...rows.map((r) => mapHeader("in", r, lineMap.get(r.in_id) ?? [])));
  }

  if (wantOut) {
    const conds = [S`1=1`];
    if (outCodes.length) conds.push(S`h.out_type IN (${join(outCodes)})`);
    if (statusFilter) conds.push(S`h.s_status = ${statusFilter}`);
    if (from) conds.push(S`h.date_time >= ${from}`);
    if (to) conds.push(S`h.date_time <= ${to}`);
    if (q.vehicleNo) conds.push(S`h.car_no LIKE ${"%" + String(q.vehicleNo) + "%"}`);
    if (q.customerId) conds.push(S`h.cust = ${String(q.customerId)}`);
    if (q.materialId || q.retrievalCode) {
      const dconds = [S`d.out_id = h.out_id`];
      if (q.materialId) dconds.push(S`d.material_id = ${String(q.materialId)}`);
      if (q.retrievalCode) dconds.push(S`d.s_code LIKE ${"%" + String(q.retrievalCode) + "%"}`);
      conds.push(S`EXISTS (SELECT 1 FROM t_stock_out_detail d WHERE ${join(dconds, " AND ")})`);
    }
    const where = join(conds, " AND ");
    const [cnt] = await db.$queryRaw<any[]>(S`SELECT COUNT(*) AS c FROM t_stock_out h WHERE ${where}`);
    total += Number(cnt.c);
    const rows = await db.$queryRaw<any[]>(
      S`SELECT * FROM (
          SELECT h.out_id, h.out_type, h.date_time, h.s_status, h.car_no, h.batch_no, h.memo,
                 h.audit_person, h.entry_person, st.stock_name, c.cust_name, p.name AS entry_name,
                 ROW_NUMBER() OVER (ORDER BY h.date_time DESC, h.out_id DESC) AS rn
          FROM t_stock_out h
          LEFT JOIN t_a_stock st ON st.stock = h.stock
          LEFT JOIN t_a_cust c ON c.cust = h.cust
          LEFT JOIN t_a_personnel p ON p.personnel = h.entry_person
          WHERE ${where}
        ) x WHERE x.rn BETWEEN ${first} AND ${last} ORDER BY x.rn`
    );
    const lineMap = await fetchLines("out", rows.map((r) => r.out_id), uNames);
    items.push(...rows.map((r) => mapHeader("out", r, lineMap.get(r.out_id) ?? [])));
  }

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  res.json({ total, page, pageSize, items: items.slice(0, pageSize) });
});

cloudDocumentsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id);
  const uNames = await unitNames();
  const inRows = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 h.in_id, h.in_type, h.date_time, h.s_status, h.car_no2, h.batch_no, h.memo,
             h.audit_person, h.entry_person, st.stock_name, c.cust_name, p.name AS entry_name
      FROM t_stock_in h
      LEFT JOIN t_a_stock st ON st.stock = h.stock
      LEFT JOIN t_a_cust c ON c.cust = h.in_cust
      LEFT JOIN t_a_personnel p ON p.personnel = h.entry_person
      WHERE h.in_id = ${id}`
  );
  if (inRows[0]) {
    const lineMap = await fetchLines("in", [id], uNames);
    return res.json(mapHeader("in", inRows[0], lineMap.get(id) ?? []));
  }
  const outRows = await db.$queryRaw<any[]>(
    S`SELECT TOP 1 h.out_id, h.out_type, h.date_time, h.s_status, h.car_no, h.batch_no, h.memo,
             h.audit_person, h.entry_person, st.stock_name, c.cust_name, p.name AS entry_name
      FROM t_stock_out h
      LEFT JOIN t_a_stock st ON st.stock = h.stock
      LEFT JOIN t_a_cust c ON c.cust = h.cust
      LEFT JOIN t_a_personnel p ON p.personnel = h.entry_person
      WHERE h.out_id = ${id}`
  );
  if (outRows[0]) {
    const lineMap = await fetchLines("out", [id], uNames);
    return res.json(mapHeader("out", outRows[0], lineMap.get(id) ?? []));
  }
  res.status(404).json({ error: "单据不存在" });
});

// 只读模式：不注册任何写路由(新单/修改/删除/审核)。index.ts 的只读中间件亦会兜底拦截非 GET 请求。

// ---------- 工作台聚合(只读): 分类库存 / 今日与本周动态 / 在库品种数 ----------
export const cloudDashboardRouter = Router();

cloudDashboardRouter.get("/", async (_req, res) => {
  const uNames = await unitNames();
  const [catRows, skuRows, todayIn, todayOut, weekIn, weekOut] = await Promise.all([
    db.$queryRaw<any[]>(S`
      WITH mv AS (
        SELECT d.material_id, d.unit, CAST(d.quantity AS decimal(38,4)) AS qin, CAST(0 AS decimal(38,4)) AS qout
        FROM t_stock_in h INNER JOIN t_stock_in_detail d ON d.in_id = h.in_id
        UNION ALL
        SELECT d.material_id, d.unit, CAST(0 AS decimal(38,4)), CAST(d.quantity AS decimal(38,4))
        FROM t_stock_out h INNER JOIN t_stock_out_detail d ON d.out_id = h.out_id
      )
      SELECT m.material_type, mt.material_type_name, mv.unit, SUM(mv.qin - mv.qout) AS qty
      FROM mv
      LEFT JOIN t_a_material m ON m.material_id = mv.material_id
      LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
      GROUP BY m.material_type, mt.material_type_name, mv.unit
      HAVING SUM(mv.qin - mv.qout) <> 0`),
    db.$queryRaw<any[]>(S`
      WITH mv AS (
        SELECT d.material_id, CAST(d.quantity AS decimal(38,4)) AS q FROM t_stock_in_detail d
        UNION ALL
        SELECT d.material_id, CAST(-d.quantity AS decimal(38,4)) FROM t_stock_out_detail d
      )
      SELECT COUNT(*) AS c FROM (
        SELECT material_id FROM mv GROUP BY material_id HAVING SUM(q) <> 0
      ) x`),
    db.$queryRaw<any[]>(S`
      SELECT COUNT(DISTINCT h.in_id) AS c, ISNULL(SUM(d.quantity), 0) AS q
      FROM t_stock_in h INNER JOIN t_stock_in_detail d ON d.in_id = h.in_id
      WHERE h.date_time >= CAST(GETDATE() AS date)`),
    db.$queryRaw<any[]>(S`
      SELECT COUNT(DISTINCT h.out_id) AS c, ISNULL(SUM(d.quantity), 0) AS q
      FROM t_stock_out h INNER JOIN t_stock_out_detail d ON d.out_id = h.out_id
      WHERE h.date_time >= CAST(GETDATE() AS date)`),
    db.$queryRaw<any[]>(S`
      SELECT COUNT(DISTINCT h.in_id) AS c, ISNULL(SUM(d.quantity), 0) AS q
      FROM t_stock_in h INNER JOIN t_stock_in_detail d ON d.in_id = h.in_id
      WHERE h.date_time >= DATEADD(day, -6, CAST(GETDATE() AS date))`),
    db.$queryRaw<any[]>(S`
      SELECT COUNT(DISTINCT h.out_id) AS c, ISNULL(SUM(d.quantity), 0) AS q
      FROM t_stock_out h INNER JOIN t_stock_out_detail d ON d.out_id = h.out_id
      WHERE h.date_time >= DATEADD(day, -6, CAST(GETDATE() AS date))`),
  ]);
  res.json({
    skuCount: Number(skuRows[0]?.c ?? 0),
    categories: catRows.map((r) => ({
      category: r.material_type ?? "",
      categoryName: r.material_type_name ?? r.material_type ?? "未分类",
      unit: uNames.get(r.unit) ?? r.unit ?? "",
      quantity: Number(r.qty),
    })),
    today: {
      inDocs: Number(todayIn[0]?.c ?? 0), inQty: Number(todayIn[0]?.q ?? 0),
      outDocs: Number(todayOut[0]?.c ?? 0), outQty: Number(todayOut[0]?.q ?? 0),
    },
    week: {
      inDocs: Number(weekIn[0]?.c ?? 0), inQty: Number(weekIn[0]?.q ?? 0),
      outDocs: Number(weekOut[0]?.c ?? 0), outQty: Number(weekOut[0]?.q ?? 0),
    },
  });
});

// ---------- 批次溯源: 按检索码/车次/批次 跨入库出库全链路检索 ----------
export const cloudTraceRouter = Router();

cloudTraceRouter.get("/", async (req, res) => {
  const key = String(req.query.q ?? "").trim();
  if (!key) return res.json({ events: [] });
  const mode = req.query.mode === "material" ? "material" : "batch";
  const uNames = await unitNames();
  const like = "%" + key + "%";
  const inWhere = mode === "material"
    ? S`d.material_no = ${key} OR d.material_id = ${key}`
    : S`d.s_code LIKE ${like} OR d.batch_no = ${key} OR h.car_no2 = ${key} OR d.batch_no LIKE ${like}`;
  const outWhere = mode === "material"
    ? S`d.material_no = ${key} OR d.material_id = ${key}`
    : S`d.s_code LIKE ${like} OR d.batch_no = ${key} OR h.car_no = ${key} OR d.batch_no LIKE ${like}`;

  const ins = await db.$queryRaw<any[]>(
    S`SELECT h.in_id AS doc_no, h.in_type AS type_code, h.date_time, h.s_status, h.car_no2 AS car_no,
             st.stock_name, t.in_type_name AS type_name,
             d.material_id, d.material_no, d.material_name, d.quantity, d.unit, d.batch_no, d.s_code, d.man_address,
             m.material_type, mt.material_type_name, s.supplier_name, c.cust_name, 'in' AS kind
      FROM t_stock_in_detail d
      JOIN t_stock_in h ON h.in_id = d.in_id
      LEFT JOIN t_a_in_type t ON t.in_type = h.in_type
      LEFT JOIN t_a_stock st ON st.stock = h.stock
      LEFT JOIN t_a_material m ON m.material_id = d.material_id
      LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
      LEFT JOIN t_a_supplier s ON s.supplier = d.supplier
      LEFT JOIN t_a_cust c ON c.cust = h.in_cust
      WHERE ${inWhere}`
  );
  const outs = await db.$queryRaw<any[]>(
    S`SELECT h.out_id AS doc_no, h.out_type AS type_code, h.date_time, h.s_status, h.car_no AS car_no,
             st.stock_name, t.out_type_name AS type_name,
             d.material_id, d.material_no, d.material_name, d.quantity, d.unit, d.batch_no, d.s_code, d.man_address,
             m.material_type, mt.material_type_name, NULL AS supplier_name, c.cust_name, 'out' AS kind
      FROM t_stock_out_detail d
      JOIN t_stock_out h ON h.out_id = d.out_id
      LEFT JOIN t_a_out_type t ON t.out_type = h.out_type
      LEFT JOIN t_a_stock st ON st.stock = h.stock
      LEFT JOIN t_a_material m ON m.material_id = d.material_id
      LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
      LEFT JOIN t_a_cust c ON c.cust = h.cust
      WHERE ${outWhere}`
  );

  const events = [...ins, ...outs]
    .map((r) => ({
      kind: r.kind,
      docNo: r.doc_no,
      docType: `${r.kind === "in" ? "IN_" : "OUT_"}${r.type_code}`,
      typeName: r.type_name ?? r.type_code,
      date: r.date_time,
      status: statusMap(r.s_status),
      warehouse: r.stock_name,
      vehicleNo: r.car_no,
      material: { id: r.material_id, code: r.material_no ?? r.material_id, name: r.material_name ?? "" },
      category: r.material_type ?? "",
      categoryName: r.material_type_name ?? r.material_type ?? "",
      quantity: Number(r.quantity),
      unit: uNames.get(r.unit) ?? r.unit,
      batchNo: r.batch_no,
      retrievalCode: r.s_code,
      origin: r.man_address,
      partner: r.supplier_name ?? r.cust_name ?? null,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === "in" ? -1 : 1));
  res.json({ events });
});

// ---------- 即时库存 ----------
export const cloudInventoryRouter = Router();

function selectedMaterialNames(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

interface InventoryMovementRow {
  stock: string;
  stock_name: string | null;
  material_name: string;
  material_type: string | null;
  unit: string;
  in_quantity: unknown;
  out_quantity: unknown;
  quantity: unknown;
}

interface InventoryNameRow {
  material_name: string;
}

cloudInventoryRouter.get("/", async (req, res) => {
  const q = req.query;
  const uNames = await unitNames();
  const byBatch = q.byBatch === "1" || q.byBatch === "true";
  const names = selectedMaterialNames(q.materialNames);
  const nameRows = await db.$queryRaw<InventoryNameRow[]>(S`
    SELECT material_name
    FROM (
      SELECT DISTINCT LTRIM(RTRIM(d.material_name)) AS material_name
      FROM t_stock_in_detail d
      INNER JOIN t_stock_in h ON h.in_id = d.in_id
      WHERE NULLIF(LTRIM(RTRIM(d.material_name)), N'') IS NOT NULL
      UNION
      SELECT DISTINCT LTRIM(RTRIM(d.material_name)) AS material_name
      FROM t_stock_out_detail d
      INNER JOIN t_stock_out h ON h.out_id = d.out_id
      WHERE NULLIF(LTRIM(RTRIM(d.material_name)), N'') IS NOT NULL
    ) names
    ORDER BY material_name
  `);
  const materialNames = nameRows.map((row) => row.material_name);

  // 服务端多选筛选(逗号分隔)。前端 antd 多选一变就带这些参数重新查库。
  const csv = (v: unknown) => (typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const fWarehouses = csv(q.warehouseIds);
  const fSuppliers = csv(q.suppliers);
  const fOrigins = csv(q.origins);
  const fCategories = csv(q.categories);
  const fText = typeof q.q === "string" ? q.q.trim() : "";
  const fLike = "%" + fText + "%";

  if (!byBatch) {
    // 与桌面端一致：即时库存从"所有单据"现算(不看审核状态)。
    const inConds = [S`1 = 1`];
    const outConds = [S`1 = 1`];
    if (fWarehouses.length) {
      inConds.push(S`h.stock IN (${join(fWarehouses)})`);
      outConds.push(S`h.stock IN (${join(fWarehouses)})`);
    }
    // 供应商 = 物料编码第二段(如 BCP.MRL.004 → MRL)，与桌面端一致，不依赖批次表(很多物料没有批次行)。
    // 产地 = 该物料最近一条入库明细的 man_address(单据才是产地的可靠来源)。
    const outerConds = [S`1 = 1`];
    if (fCategories.length) outerConds.push(S`m.material_type IN (${join(fCategories)})`);
    if (fSuppliers.length) outerConds.push(S`PARSENAME(agg.material_id, 2) IN (${join(fSuppliers)})`);
    if (fOrigins.length) outerConds.push(S`org.man_address IN (${join(fOrigins)})`);
    if (fText) outerConds.push(S`(m.material_no LIKE ${fLike} OR m.material_name LIKE ${fLike} OR agg.material_id LIKE ${fLike})`);

    const rows = await db.$queryRaw<any[]>(S`
      WITH mv AS (
        SELECT h.stock, d.material_id, d.unit,
               CAST(d.quantity AS decimal(38, 4)) AS qin, CAST(0 AS decimal(38, 4)) AS qout
        FROM t_stock_in h INNER JOIN t_stock_in_detail d ON d.in_id = h.in_id
        WHERE ${join(inConds, " AND ")}
        UNION ALL
        SELECT h.stock, d.material_id, d.unit,
               CAST(0 AS decimal(38, 4)) AS qin, CAST(d.quantity AS decimal(38, 4)) AS qout
        FROM t_stock_out h INNER JOIN t_stock_out_detail d ON d.out_id = h.out_id
        WHERE ${join(outConds, " AND ")}
      ),
      agg AS (
        SELECT stock, material_id, unit,
               SUM(qin) AS in_q, SUM(qout) AS out_q, SUM(qin - qout) AS qty
        FROM mv
        GROUP BY stock, material_id, unit
        HAVING SUM(qin - qout) <> 0
      )
      SELECT agg.stock, agg.material_id, agg.unit, agg.in_q, agg.out_q, agg.qty,
             st.stock_name,
             m.material_no, m.material_name, m.material_type, mt.material_type_name,
             m.spec, m.pack_spec, m.pack_unit, m.material_sort,
             PARSENAME(agg.material_id, 2) AS sup_code, sup.supplier_name,
             org.man_address
      FROM agg
      LEFT JOIN t_a_stock st ON st.stock = agg.stock
      LEFT JOIN t_a_material m ON m.material_id = agg.material_id
      LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
      LEFT JOIN t_a_supplier sup ON sup.supplier = PARSENAME(agg.material_id, 2)
      OUTER APPLY (
        SELECT TOP 1 d2.man_address
        FROM t_stock_in_detail d2 INNER JOIN t_stock_in h2 ON h2.in_id = d2.in_id
        WHERE d2.material_id = agg.material_id AND ISNULL(d2.man_address, '') <> ''
        ORDER BY h2.date_time DESC
      ) org
      WHERE ${join(outerConds, " AND ")}
      ORDER BY agg.material_id, agg.stock
    `);
    return res.json({
      rows: rows.map((r) => {
        const qty = Number(r.qty);
        const packSpec = r.pack_spec != null ? Number(r.pack_spec) : null;
        return {
          warehouseId: r.stock,
          warehouseName: r.stock_name ?? r.stock,
          materialId: r.material_id,
          materialCode: r.material_no ?? r.material_id,
          materialName: r.material_name ?? "",
          category: r.material_type ?? "",
          categoryName: r.material_type_name ?? r.material_type ?? "",
          shortName: r.material_sort ?? "",
          unit: uNames.get(r.unit) ?? r.unit ?? "",
          supplier: r.sup_code ?? null,
          supplierName: r.supplier_name ?? r.sup_code ?? "",
          origin: r.man_address ?? null,
          moisture: r.spec ?? "",
          packSpec,
          packUnit: r.pack_unit ? (uNames.get(r.pack_unit) ?? r.pack_unit) : "",
          packQty: packSpec && packSpec > 0 ? Math.round((qty / packSpec) * 100) / 100 : null,
          batchNo: null,
          retrievalCode: null,
          inQuantity: Number(r.in_q),
          outQuantity: Number(r.out_q),
          quantity: qty,
        };
      }),
      materialNames,
    });
  }

  // 批次结余同样从明细实时计算：批次入库量 - 批次出库量。
  // t_material_batch.left_quantity 在原系统正常运行时长期为 0，不能作为库存来源。
  // 供应商优先取批次上的，缺失时回退到物料编码第二段(如 BCP.MRL.004 → MRL)，与桌面端一致。
  const conds = [S`(bal.in_quantity - bal.out_quantity) <> 0`];
  if (fWarehouses.length) conds.push(S`b.stock IN (${join(fWarehouses)})`);
  if (fCategories.length) conds.push(S`m.material_type IN (${join(fCategories)})`);
  if (fSuppliers.length) conds.push(S`COALESCE(NULLIF(b.supplier, ''), PARSENAME(b.material_id, 2)) IN (${join(fSuppliers)})`);
  if (fOrigins.length) conds.push(S`b.man_address IN (${join(fOrigins)})`);
  if (fText) conds.push(S`(m.material_no LIKE ${fLike} OR m.material_name LIKE ${fLike} OR b.material_id LIKE ${fLike})`);
  const rows = await db.$queryRaw<any[]>(
    S`WITH movements AS (
        SELECT d.material_batch_id,
               CAST(d.quantity AS decimal(38, 4)) AS in_quantity,
               CAST(0 AS decimal(38, 4)) AS out_quantity
        FROM t_stock_in_detail d
        WHERE NULLIF(LTRIM(RTRIM(d.material_batch_id)), N'') IS NOT NULL
        UNION ALL
        SELECT d.material_batch_id,
               CAST(0 AS decimal(38, 4)) AS in_quantity,
               CAST(d.quantity AS decimal(38, 4)) AS out_quantity
        FROM t_stock_out_detail d
        WHERE NULLIF(LTRIM(RTRIM(d.material_batch_id)), N'') IS NOT NULL
      ), balances AS (
        SELECT material_batch_id,
               SUM(in_quantity) AS in_quantity,
               SUM(out_quantity) AS out_quantity
        FROM movements
        GROUP BY material_batch_id
      )
      SELECT b.stock, b.material_id, b.batch_no, b.s_code, b.man_address,
             bal.in_quantity, bal.out_quantity,
             (bal.in_quantity - bal.out_quantity) AS quantity,
             COALESCE(NULLIF(b.supplier, ''), PARSENAME(b.material_id, 2)) AS supplier, sup.supplier_name,
             st.stock_name, m.material_no, m.material_name, m.material_type, mt.material_type_name,
             m.unit, m.spec, m.pack_spec, m.pack_unit, m.material_sort
      FROM balances bal
      INNER JOIN t_material_batch b ON b.material_batch_id = bal.material_batch_id
      LEFT JOIN t_a_stock st ON st.stock = b.stock
      LEFT JOIN t_a_material m ON m.material_id = b.material_id
      LEFT JOIN t_a_material_type mt ON mt.material_type = m.material_type
      LEFT JOIN t_a_supplier sup ON sup.supplier = COALESCE(NULLIF(b.supplier, ''), PARSENAME(b.material_id, 2))
      WHERE ${join(conds, " AND ")}
      ORDER BY b.material_id, b.batch_no`
  );
  res.json({
    rows: rows.map((b) => {
      const qty = Number(b.quantity);
      const packSpec = b.pack_spec != null ? Number(b.pack_spec) : null;
      return {
        warehouseId: b.stock ?? "",
        warehouseName: b.stock_name ?? b.stock ?? "",
        materialId: b.material_id ?? "",
        materialCode: b.material_no ?? b.material_id ?? "",
        materialName: b.material_name ?? "",
        category: b.material_type ?? "",
        categoryName: b.material_type_name ?? b.material_type ?? "",
        shortName: b.material_sort ?? "",
        unit: uNames.get(b.unit) ?? "",
        supplier: b.supplier ?? null,
        supplierName: b.supplier_name ?? b.supplier ?? "",
        moisture: b.spec ?? "",
        packSpec,
        packUnit: b.pack_unit ? (uNames.get(b.pack_unit) ?? b.pack_unit) : "",
        packQty: packSpec && packSpec > 0 ? Math.round((qty / packSpec) * 100) / 100 : null,
        batchNo: b.batch_no,
        retrievalCode: b.s_code,
        origin: b.man_address,
        inQuantity: Number(b.in_quantity),
        outQuantity: Number(b.out_quantity),
        quantity: qty,
      };
    }),
    materialNames,
  });
});
