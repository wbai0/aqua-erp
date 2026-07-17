import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createBrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { Checkbox, Popover, Spin } from "antd";
import {
  HomeOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
  LogoutOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
  SwapOutlined,
  DownOutlined,
  SettingOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { api, clearAuth, getToken, getUser, HealthInfo, Meta } from "./api";
import Login from "./pages/Login";
import Home from "./pages/Home";
import DocumentList from "./pages/DocumentList";
import DocumentDetail from "./pages/DocumentDetail";
import Inventory from "./pages/Inventory";
import Trace from "./pages/Trace";

const MetaContext = createContext<Meta | null>(null);
export function useMeta(): Meta {
  const m = useContext(MetaContext);
  if (!m) throw new Error("meta not loaded");
  return m;
}

export function useIsDesktop(): boolean {
  const [is, setIs] = useState(() => window.matchMedia("(min-width: 992px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 992px)");
    const fn = (e: MediaQueryListEvent) => setIs(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return is;
}

type NavItem = { to: string; icon: ReactNode; label: string };

// 手机底栏保持精简的 4 项
const BOTTOM_NAV: NavItem[] = [
  { to: "/home", icon: <HomeOutlined />, label: "首页" },
  { to: "/docs", icon: <FileTextOutlined />, label: "单据" },
  { to: "/inventory", icon: <DatabaseOutlined />, label: "库存" },
  { to: "/trace", icon: <NodeIndexOutlined />, label: "溯源" },
];

// 左侧菜单里的单据分组(入库/出库/盘点),把单据类型全部铺进来
const DOC_GROUPS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "in", label: "入库", icon: <VerticalAlignBottomOutlined /> },
  { key: "out", label: "出库", icon: <VerticalAlignTopOutlined /> },
  { key: "stocktake", label: "盘点", icon: <SwapOutlined /> },
];

const HIDDEN_DOC_TYPES_KEY = "cide-erp:hidden-doc-types:v3";
const DEFAULT_VISIBLE_DOC_TYPES = new Set([
  "IN_01", "IN_13",
  "OUT_01", "OUT_02", "OUT_08", "OUT_13",
]);

function loadHiddenDocTypes(): string[] | null {
  try {
    const stored = localStorage.getItem(HIDDEN_DOC_TYPES_KEY);
    if (stored == null) return null;
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return null;
  }
}

function getDefaultHiddenDocTypes(docTypes: Meta["docTypes"]): string[] {
  return docTypes
    .filter((type) => (type.group === "in" || type.group === "out") && !DEFAULT_VISIBLE_DOC_TYPES.has(type.key))
    .map((type) => type.key);
}

function Shell() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ in: true, out: true, stocktake: false });
  const [hiddenDocTypes, setHiddenDocTypes] = useState<string[] | null>(loadHiddenDocTypes);
  const location = useLocation();
  const user = getUser();

  useEffect(() => {
    api<Meta>("/masters/meta").then(setMeta).catch((e) => setError(e.message));
    api<HealthInfo>("/health").then(setHealth).catch(() => setHealth(null));
  }, []);

  if (!getToken()) return <Navigate to="/login" replace />;
  if (error) return <div style={{ padding: 24 }}>加载失败: {error}</div>;
  if (!meta)
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );

  function logout() {
    clearAuth();
    window.location.href = "/login";
  }

  const defaultHiddenDocTypes = getDefaultHiddenDocTypes(meta.docTypes);
  const effectiveHiddenDocTypes = hiddenDocTypes ?? defaultHiddenDocTypes;

  function setDocTypeVisible(key: string, visible: boolean) {
    setHiddenDocTypes((current) => {
      const currentHidden = current ?? defaultHiddenDocTypes;
      const next = visible ? currentHidden.filter((item) => item !== key) : [...new Set([...currentHidden, key])];
      localStorage.setItem(HIDDEN_DOC_TYPES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function showAllDocTypes(keys: string[]) {
    setHiddenDocTypes((current) => {
      const currentHidden = current ?? defaultHiddenDocTypes;
      const next = currentHidden.filter((key) => !keys.includes(key));
      localStorage.setItem(HIDDEN_DOC_TYPES_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <MetaContext.Provider value={meta}>
      <div className="app-shell">
        <aside className="side-nav">
          <div className="brand">
            <div className="logo">慈德</div>
            <div>
              <div className="brand-name">慈德ERP</div>
              <div className="brand-sub">仓储管理系统</div>
            </div>
          </div>
          <nav className="nav-links">
            <NavLink to="/home" className={location.pathname.startsWith("/home") ? "active" : ""}>
              <HomeOutlined /> 首页
            </NavLink>

            {DOC_GROUPS.map((g) => {
              const types = meta.docTypes.filter((t) => t.group === g.key);
              if (!types.length) return null;
              const open = openGroups[g.key] ?? true;
              const sp = new URLSearchParams(location.search);
              const onDocs = location.pathname === "/docs";
              const qType = sp.get("type");
              const qGroup = sp.get("group");
              const visibleTypes = types.filter((type) => !effectiveHiddenDocTypes.includes(type.key));
              const visibilitySettings = (
                <div className="nav-visibility-popover" onClick={(event) => event.stopPropagation()}>
                  <div className="nav-visibility-title">
                    <span>{g.label}菜单显示</span>
                    <button type="button" onClick={() => showAllDocTypes(types.map((type) => type.key))}>全部显示</button>
                  </div>
                  <div className="nav-visibility-options">
                    {types.map((type) => (
                      <Checkbox
                        key={type.key}
                        checked={!effectiveHiddenDocTypes.includes(type.key)}
                        onChange={(event) => setDocTypeVisible(type.key, event.target.checked)}
                      >
                        {type.label}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              );
              return (
                <div key={g.key}>
                  <div
                    className="nav-group-header"
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !open }))}
                  >
                    <span className="g-left">{g.icon} {g.label}</span>
                    <span className="g-actions">
                      <Popover content={visibilitySettings} trigger="click" placement="rightTop">
                        <button
                          type="button"
                          className="nav-visibility-button"
                          aria-label={`设置${g.label}菜单显示`}
                          title="设置菜单显示"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <SettingOutlined />
                        </button>
                      </Popover>
                      {open ? <DownOutlined className="g-caret" /> : <RightOutlined className="g-caret" />}
                    </span>
                  </div>
                  {open && (
                    <div className="nav-sub">
                      <NavLink
                        to={`/docs?group=${g.key}`}
                        className={() => (onDocs && qGroup === g.key && !qType ? "active" : "")}
                      >
                        全部{g.label}
                      </NavLink>
                      {visibleTypes.map((t) => (
                        <NavLink
                          key={t.key}
                          to={`/docs?group=${g.key}&type=${encodeURIComponent(t.key)}`}
                          className={() => (onDocs && qType === t.key ? "active" : "")}
                        >
                          {t.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <NavLink to="/inventory" className={location.pathname.startsWith("/inventory") ? "active" : ""}>
              <DatabaseOutlined /> 库存
            </NavLink>
            <NavLink to="/trace" className={location.pathname.startsWith("/trace") ? "active" : ""}>
              <NodeIndexOutlined /> 溯源
            </NavLink>
          </nav>
          <div className="nav-user">
            <span>{user?.displayName}</span>
            <LogoutOutlined className="logout" onClick={logout} />
          </div>
        </aside>

        <main className="app-main">
          <div className="environment-context" title="当前数据库连接">
            <DatabaseOutlined />
            <span className={health?.database.isLocal ? "environment-badge local" : "environment-badge remote"}>
              {health?.database.label ?? "UNKNOWN"}
            </span>
          </div>
          <Outlet />
        </main>

        <nav className="bottom-nav">
          {BOTTOM_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={location.pathname.startsWith(n.to) ? "active" : ""}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </MetaContext.Provider>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Navigate to="/home" replace /> },
      { path: "/home", element: <Home /> },
      { path: "/docs", element: <DocumentList /> },
      { path: "/inventory", element: <Inventory /> },
      { path: "/trace", element: <Trace /> },
      { path: "/documents/:id", element: <DocumentDetail /> },
      // 旧路径兼容
      { path: "/in", element: <Navigate to="/docs?group=in" replace /> },
      { path: "/out", element: <Navigate to="/docs?group=out" replace /> },
      { path: "/stocktake", element: <Navigate to="/docs?group=stocktake" replace /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
