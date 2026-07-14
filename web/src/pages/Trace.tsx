import { useCallback, useEffect, useState } from "react";
import { Empty, Input, Spin, Steps, Tag, Timeline } from "antd";
import { SearchOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { api } from "../api";

interface TraceEvent {
  kind: "in" | "out";
  docNo: string;
  typeName: string;
  date: string;
  status: "DRAFT" | "APPROVED";
  warehouse: string;
  vehicleNo?: string | null;
  material: { id: string; code: string; name: string };
  category: string;
  categoryName?: string;
  quantity: number;
  unit: string;
  batchNo?: string | null;
  retrievalCode?: string | null;
  origin?: string | null;
  partner?: string | null;
}

const STAGE_ORDER = ["毛料", "半成品", "成品"];

// 生产库类别: WYL 外购原材料 / BCP 半成品 / CP 成品库 / XP 虾片 ...
function stageOf(e: { category: string; categoryName?: string }): string {
  const n = e.categoryName ?? e.category ?? "";
  if (n.includes("原材料") || n.includes("毛料")) return "毛料";
  if (n.includes("半成品")) return "半成品";
  if (n.includes("成品") || n.includes("虾片")) return "成品";
  return "其它";
}

export default function Trace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [events, setEvents] = useState<TraceEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (key: string) => {
    if (!key) {
      setEvents(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ events: TraceEvent[] }>("/trace", { query: { q: key } });
      setEvents(res.events);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInput(q);
    load(q);
  }, [q, load]);

  // 阶段进度: 出现过哪些物料阶段
  const stagesPresent = new Set((events ?? []).map(stageOf));
  const currentStage = STAGE_ORDER.reduce((acc, s, i) => (stagesPresent.has(s) ? i : acc), -1);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">批次溯源</h1>
      </div>

      <div className="panel">
        <Input.Search
          size="large"
          prefix={<SearchOutlined style={{ color: "#bbb" }} />}
          placeholder="输入 检索码 / 车次 / 批次号, 如 WXF.XH.25.14 或 25-14"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onSearch={(v) => setSearchParams(v ? { q: v.trim() } : {})}
          enterButton="溯源"
          allowClear
        />
        {events && events.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <Steps
              size="small"
              current={currentStage}
              items={STAGE_ORDER.map((s) => ({
                title: s,
                description: stagesPresent.has(s) ? `${(events ?? []).filter((e) => stageOf(e) === s).length} 笔` : "—",
              }))}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : events === null ? (
        <Empty description="输入检索码或车次开始追溯 — 从毛料到成品的完整链路" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : events.length === 0 ? (
        <Empty description={`未找到与「${q}」相关的出入库记录`} />
      ) : (
        <div className="panel">
          <Timeline
            items={events.map((e) => ({
              color: e.kind === "in" ? "blue" : "orange",
              dot: e.kind === "in" ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />,
              children: (
                <div className="trace-event" onClick={() => navigate(`/documents/${e.docNo}`)} style={{ cursor: "pointer" }}>
                  <div className="t-title">
                    {e.typeName}{" "}
                    <span style={{ color: "#0958d9", fontWeight: 500 }}>{e.docNo}</span>{" "}
                    <Tag className="trace-stage-tag" color={stageOf(e) === "毛料" ? "gold" : stageOf(e) === "半成品" ? "cyan" : stageOf(e) === "成品" ? "green" : "default"}>
                      {e.categoryName || e.category || "其它"}
                    </Tag>
                    <Tag className="trace-stage-tag" color={e.status === "APPROVED" ? "green" : "orange"}>
                      {e.status === "APPROVED" ? "已审核" : "未审核"}
                    </Tag>
                  </div>
                  <div className="t-sub">
                    {dayjs(e.date).format("YYYY-MM-DD")} · {e.warehouse} · {e.material.code} {e.material.name} ·{" "}
                    <b className="num">
                      {e.kind === "in" ? "+" : "−"}
                      {e.quantity.toLocaleString()} {e.unit}
                    </b>
                    {e.vehicleNo ? ` · 车次 ${e.vehicleNo}` : ""}
                    {e.origin ? ` · ${e.origin}` : ""}
                    {e.partner ? ` · ${e.partner}` : ""}
                  </div>
                </div>
              ),
            }))}
          />
        </div>
      )}
    </div>
  );
}
