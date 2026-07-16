import "./env";
import express from "express";
import cors from "cors";
import path from "path";
import { authRouter, requireAuth } from "./auth";
import { mastersRouter } from "./routes/masters";
import { documentsRouter } from "./routes/documents";
import { inventoryRouter } from "./routes/inventory";
import { describeSqlServerDatabase } from "./cloud/access";

const app = express();
app.use(cors());
app.use(express.json());

const cloudMode = process.env.DATA_SOURCE === "cloud";
// 只读模式：默认在 cloud 模式下开启。直连生产库时，绝不允许任何写操作。
const readOnly = process.env.READ_ONLY !== "false" && cloudMode;
const database = describeSqlServerDatabase(cloudMode ? process.env.CLOUD_DATABASE_URL : process.env.DATABASE_URL);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, mode: cloudMode ? "cloud" : "local", readOnly, database })
);

// ⛔ 只读硬拦截：除登录外，拒绝一切非 GET 请求（新单/修改/删除/审核/取消审核/批量审核等全部挡在服务端）。
if (readOnly) {
  app.use("/api", (req, res, next) => {
    const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
    const isLogin = req.method === "POST" && req.path === "/auth/login";
    if (safe || isLogin) return next();
    return res.status(403).json({ error: "系统为只读模式，不支持新增/修改/审核等写操作" });
  });
}

if (cloudMode) {
  // cloud 模式下，所有业务读写统一使用 CLOUD_DATABASE_URL 指向的数据库。
  const {
    cloudAuthRouter,
    cloudMastersRouter,
    cloudDocumentsRouter,
    cloudInventoryRouter,
    cloudTraceRouter,
    cloudDashboardRouter,
  } = require("./cloud/router");
  app.use("/api/auth", cloudAuthRouter);
  app.use("/api/masters", requireAuth, cloudMastersRouter);
  app.use("/api/documents", requireAuth, cloudDocumentsRouter);
  app.use("/api/inventory", requireAuth, cloudInventoryRouter);
  app.use("/api/trace", requireAuth, cloudTraceRouter);
  app.use("/api/dashboard", requireAuth, cloudDashboardRouter);
} else {
  app.use("/api/auth", authRouter);
  app.use("/api/masters", requireAuth, mastersRouter);
  app.use("/api/documents", requireAuth, documentsRouter);
  app.use("/api/inventory", requireAuth, inventoryRouter);
}

// 生产环境: 托管前端构建产物 (npm run build 后)
const webDist = path.join(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

// 统一错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "服务器内部错误" });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`慈德ERP API listening on http://localhost:${port}`);
});
