import { createContext, useContext, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
} from "react-router-dom";
import { Spin } from "antd";
import {
  HomeOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { api, clearAuth, getToken, getUser, Meta } from "./api";
import Login from "./pages/Login";
import Home from "./pages/Home";
import DocumentList from "./pages/DocumentList";
import DocumentDetail from "./pages/DocumentDetail";
import DocumentForm from "./pages/DocumentForm";
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

const NAV = [
  { to: "/home", icon: <HomeOutlined />, label: "首页" },
  { to: "/docs", icon: <FileTextOutlined />, label: "单据" },
  { to: "/inventory", icon: <DatabaseOutlined />, label: "库存" },
  { to: "/trace", icon: <NodeIndexOutlined />, label: "溯源" },
];

function Shell() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const user = getUser();

  useEffect(() => {
    api<Meta>("/masters/meta").then(setMeta).catch((e) => setError(e.message));
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
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={location.pathname.startsWith(n.to) ? "active" : ""}>
                {n.icon} {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="nav-user">
            <span>{user?.displayName}</span>
            <LogoutOutlined className="logout" onClick={logout} />
          </div>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>

        <nav className="bottom-nav">
          {NAV.map((n) => (
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/docs" element={<DocumentList />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/documents/new" element={<DocumentForm />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/documents/:id/edit" element={<DocumentForm />} />
          {/* 旧路径兼容 */}
          <Route path="/in" element={<Navigate to="/docs?group=in" replace />} />
          <Route path="/out" element={<Navigate to="/docs?group=out" replace />} />
          <Route path="/stocktake" element={<Navigate to="/docs?group=stocktake" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
