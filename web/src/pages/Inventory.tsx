import { useCallback, useEffect, useState } from "react";
import { Segmented, Select, Spin, Switch, Table } from "antd";
import { api, CATEGORY_LABELS, StockRow } from "../api";
import { useMeta } from "../App";

export default function Inventory() {
  const meta = useMeta();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState<number>();
  const [category, setCategory] = useState<string>("ALL");
  const [byBatch, setByBatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rows: StockRow[] }>("/inventory", {
        query: {
          warehouseId,
          category: category === "ALL" ? undefined : category,
          byBatch: byBatch ? "1" : undefined,
        },
      });
      setRows(res.rows);
    } finally {
      setLoading(false);
    }
  }, [warehouseId, category, byBatch]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">即时库存</h1>
        <span>
          按批次 <Switch checked={byBatch} onChange={setByBatch} />
        </span>
      </div>

      <div className="filter-bar">
        <Select
          allowClear
          placeholder="仓库"
          value={warehouseId}
          onChange={setWarehouseId}
          options={meta.warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />
        <Segmented
          value={category}
          onChange={(v) => setCategory(String(v))}
          options={[
            { value: "ALL", label: "全部" },
            ...[...new Map(meta.materials.map((m) => [m.category, m.categoryName ?? m.category])).entries()].map(
              ([c, name]) => ({ value: c, label: name })
            ),
          ]}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Table
          rowKey={(r) => `${r.warehouseId}-${r.materialId}-${r.batchNo ?? ""}-${r.retrievalCode ?? ""}`}
          dataSource={rows}
          size="small"
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            { title: "仓库", dataIndex: "warehouseName" },
            { title: "物料编码", dataIndex: "materialCode" },
            { title: "品名", dataIndex: "materialName" },
            {
              title: "类别",
              dataIndex: "category",
              render: (c) =>
                meta.materials.find((m) => m.category === c)?.categoryName ?? CATEGORY_LABELS[c] ?? c,
            },
            ...(byBatch
              ? [
                  { title: "批次/车次", dataIndex: "batchNo" as const },
                  { title: "检索码", dataIndex: "retrievalCode" as const },
                  { title: "产地", dataIndex: "origin" as const },
                ]
              : []),
            {
              title: "库存数量",
              align: "right" as const,
              render: (_, r) => (
                <span style={{ fontWeight: 600, color: r.quantity < 0 ? "#cf1322" : undefined }}>
                  {r.quantity.toLocaleString()} {r.unit}
                </span>
              ),
            },
          ]}
          summary={(data) => {
            const byUnit = new Map<string, number>();
            for (const r of data) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.quantity);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={byBatch ? 7 : 4}>
                  合计
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  {[...byUnit.entries()].map(([u, q]) => `${q.toLocaleString()} ${u}`).join(" / ")}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      )}
    </div>
  );
}
