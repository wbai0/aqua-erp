import { useEffect, useState } from "react";
import { Button, Empty, Input, Spin } from "antd";
import {
  DatabaseOutlined,
  FileTextOutlined,
  LogoutOutlined,
  NodeIndexOutlined,
  RightOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { api, clearAuth, Doc, getUser } from "../api";
import { useMeta } from "../App";

interface Dashboard {
  skuCount: number;
  categories: { category: string; categoryName: string; unit: string; quantity: number }[];
  today: { inDocs: number; inQty: number; outDocs: number; outQty: number };
  week: { inDocs: number; inQty: number; outDocs: number; outQty: number };
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Home() {
  const meta = useMeta();
  const navigate = useNavigate();
  const user = getUser();

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [recent, setRecent] = useState<Doc[] | null>(null);

  useEffect(() => {
    api<Dashboard>("/dashboard").then(setDash).catch(() => setDash(null));
    api<{ items: Doc[] }>("/documents", { query: { pageSize: 8 } })
      .then((r) => setRecent(r.items))
      .catch(() => setRecent([]));
  }, []);

  // 分类库存: {类别 → [{unit, quantity}...]}
  const catGroups = new Map<string, { unit: string; quantity: number }[]>();
  for (const c of dash?.categories ?? []) {
    if (!catGroups.has(c.categoryName)) catGroups.set(c.categoryName, []);
    catGroups.get(c.categoryName)!.push({ unit: c.unit, quantity: c.quantity });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">工作台</h1>
          <span style={{ color: "var(--text-3)", fontSize: 13 }}>
            {user?.displayName} · {dayjs().format("M月D日 dddd")} · 数据实时来自生产库(只读)
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

      {/* 快捷入口 + 溯源直达 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="large" icon={<DatabaseOutlined />} onClick={() => navigate("/inventory")}>
          即时库存
        </Button>
        <Button size="large" icon={<FileTextOutlined />} onClick={() => navigate("/docs")}>
          单据查询
        </Button>
        <Input.Search
          size="large"
          style={{ flex: "1 1 240px", maxWidth: 380 }}
          placeholder="输入检索码 / 车次 直接溯源，如 WXF.XH.2501"
          prefix={<NodeIndexOutlined style={{ color: "var(--text-3)" }} />}
          onSearch={(v) => v.trim() && navigate(`/trace?q=${encodeURIComponent(v.trim())}`)}
          enterButton="溯源"
        />
      </div>

      {/* 库存总览: 在库品种 + 各类别库存 */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="s-label">在库品种</div>
          <div className="s-value primary">{dash === null ? "—" : dash.skuCount}</div>
          <div className="s-sub">当前有结余的物料数</div>
        </div>
        {[...catGroups.entries()].map(([name, units]) => (
          <div key={name} className="stat-card" style={{ cursor: "pointer" }} onClick={() => navigate("/inventory")}>
            <div className="s-label">{name}</div>
            <div className="s-value">
              {units.map((u) => `${fmt(u.quantity)}`).join(" / ")}
            </div>
            <div className="s-sub">{units.map((u) => u.unit).join(" / ")}</div>
          </div>
        ))}
      </div>

      {/* 出入库动态 */}
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="s-label"><VerticalAlignBottomOutlined /> 今日入库</div>
          <div className="s-value">{dash === null ? "—" : dash.today.inDocs} <small>单</small></div>
          <div className="s-sub">{dash === null ? "" : `${fmt(dash.today.inQty)} 数量合计`}</div>
        </div>
        <div className="stat-card">
          <div className="s-label"><VerticalAlignTopOutlined /> 今日出库</div>
          <div className="s-value">{dash === null ? "—" : dash.today.outDocs} <small>单</small></div>
          <div className="s-sub">{dash === null ? "" : `${fmt(dash.today.outQty)} 数量合计`}</div>
        </div>
        <div className="stat-card">
          <div className="s-label">近7天入库</div>
          <div className="s-value">{dash === null ? "—" : dash.week.inDocs} <small>单</small></div>
          <div className="s-sub">{dash === null ? "" : `${fmt(dash.week.inQty)} 数量合计`}</div>
        </div>
        <div className="stat-card">
          <div className="s-label">近7天出库</div>
          <div className="s-value">{dash === null ? "—" : dash.week.outDocs} <small>单</small></div>
          <div className="s-sub">{dash === null ? "" : `${fmt(dash.week.outQty)} 数量合计`}</div>
        </div>
      </div>

      {/* 最近单据 */}
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
            const line = doc.lines[0];
            const qty = doc.lines.reduce((s, l) => s + Number(l.quantity), 0);
            const units = [...new Set(doc.lines.map((l) => l.unit))].join("/");
            return (
              <div
                key={String(doc.id)}
                onClick={() => navigate(`/documents/${doc.id}`)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: "1px solid #f2f3f5",
                  cursor: "pointer",
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="num" style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {doc.docNo}
                    <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 500, fontSize: 12 }}>{typeLabel}</span>
                  </div>
                  <div style={{ color: "var(--text-3)", fontSize: 12, marginTop: 2 }}>
                    {dayjs(doc.date).format("MM-DD")}
                    {doc.supplier ? ` · ${doc.supplier.name}` : doc.customer ? ` · ${doc.customer.name}` : ""}
                    {line?.retrievalCode ? ` · ${line.retrievalCode}` : ""}
                    {line?.material?.name ? ` · ${line.material.name}${doc.lines.length > 1 ? ` 等${doc.lines.length}项` : ""}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span className="num" style={{ fontWeight: 600 }}>{fmt(qty)} {units}</span>
                  <RightOutlined style={{ color: "#c8cdd4", fontSize: 11 }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
