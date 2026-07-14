import { useEffect, useState } from "react";
import { Button, Empty, Spin, Tag } from "antd";
import { LogoutOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { api, clearAuth, Doc, getUser, StockRow } from "../api";
import { useMeta } from "../App";

export default function Home() {
  const meta = useMeta();
  const navigate = useNavigate();
  const user = getUser();
  const canWrite = meta.capabilities?.canWriteDocs !== false;

  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [recent, setRecent] = useState<Doc[] | null>(null);

  useEffect(() => {
    api<{ rows: StockRow[] }>("/inventory").then((r) => setStock(r.rows)).catch(() => setStock([]));
    api<{ items: Doc[] }>("/documents", { query: { pageSize: 6 } })
      .then((r) => setRecent(r.items))
      .catch(() => setRecent([]));
  }, []);

  const firstInType = meta.docTypes.find((t) => t.group === "in")?.key;
  const firstOutType = meta.docTypes.find((t) => t.group === "out")?.key;

  const byUnit = new Map<string, number>();
  for (const r of stock ?? []) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.quantity);
  const draftCount = (recent ?? []).filter((d) => d.status === "DRAFT").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">工作台</h1>
          <span style={{ color: "#8c8c8c", fontSize: 13 }}>
            {user?.displayName} · {dayjs().format("M月D日 dddd")}
          </span>
        </div>
        <Button
          size="small"
          icon={<LogoutOutlined />}
          onClick={() => {
            clearAuth();
            navigate("/login");
          }}
        />
      </div>

      {canWrite && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {firstInType && (
            <Button
              type="primary"
              size="large"
              style={{ flex: "1 1 140px", height: 48 }}
              icon={<VerticalAlignBottomOutlined />}
              onClick={() => navigate(`/documents/new?type=${firstInType}`)}
            >
              新建入库
            </Button>
          )}
          {firstOutType && (
            <Button
              size="large"
              style={{ flex: "1 1 140px", height: 48 }}
              icon={<VerticalAlignTopOutlined />}
              onClick={() => navigate(`/documents/new?type=${firstOutType}`)}
            >
              新建出库
            </Button>
          )}
          <Button
            size="large"
            style={{ flex: "1 1 140px", height: 48 }}
            icon={<NodeIndexOutlined />}
            onClick={() => navigate("/trace")}
          >
            批次溯源
          </Button>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="s-label">在库品种</div>
          <div className="s-value primary">{stock === null ? "—" : stock.length}</div>
        </div>
        {[...byUnit.entries()].slice(0, 3).map(([u, q]) => (
          <div key={u} className="stat-card">
            <div className="s-label">库存总量 ({u})</div>
            <div className="s-value">{q.toLocaleString()}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="s-label">近期未审核</div>
          <div className="s-value" style={{ color: draftCount ? "#d46b08" : undefined }}>
            {recent === null ? "—" : draftCount}
          </div>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <b>最近单据</b>
          <a onClick={() => navigate("/docs")}>全部单据</a>
        </div>
        {recent === null ? (
          <Spin />
        ) : recent.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无单据" />
        ) : (
          recent.map((doc) => {
            const typeLabel = meta.docTypes.find((t) => t.key === doc.docType)?.label ?? doc.docType;
            return (
              <div
                key={String(doc.id)}
                onClick={() => navigate(`/documents/${doc.id}`)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: "1px solid #f0f0f0",
                  cursor: "pointer",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="num" style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {doc.docNo}
                  </div>
                  <div style={{ color: "#8c8c8c", fontSize: 12 }}>
                    {typeLabel} · {dayjs(doc.date).format("MM-DD")}
                    {doc.supplier ? ` · ${doc.supplier.name}` : doc.customer ? ` · ${doc.customer.name}` : ""}
                  </div>
                </div>
                <Tag color={doc.status === "APPROVED" ? "green" : "orange"} style={{ margin: 0 }}>
                  {doc.status === "APPROVED" ? "已审核" : "未审核"}
                </Tag>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
