import "./env";
import express from "express";
import cors from "cors";
import path from "path";
import { authRouter, requireAuth } from "./auth";
import { mastersRouter } from "./routes/masters";
import { documentsRouter } from "./routes/documents";
import { inventoryRouter } from "./routes/inventory";

const app = express();
app.use(cors());
app.use(express.json());

const cloudMode = process.env.DATA_SOURCE === "cloud";
app.get("/api/health", (_req, res) => res.json({ ok: true, mode: cloudMode ? "cloud" : "local" }));

if (cloudMode) {
  // 云端模式: 直连生产库 cide_main (阶段一: 单据只读)
  const {
    cloudAuthRouter,
    cloudMastersRouter,
    cloudDocumentsRouter,
    cloudInventoryRouter,
    cloudTraceRouter,
  } = require("./cloud/router");
  const { requireLocalReplicaWrite } = require("./cloud/access");
  app.use("/api/auth", cloudAuthRouter);
  // cloud 模式的业务接口共用同一个写入边界：本地副本可写，远端数据库只读。
  app.use("/api/masters", requireAuth, requireLocalReplicaWrite, cloudMastersRouter);
  app.use("/api/documents", requireAuth, requireLocalReplicaWrite, cloudDocumentsRouter);
  app.use("/api/inventory", requireAuth, requireLocalReplicaWrite, cloudInventoryRouter);
  app.use("/api/trace", requireAuth, requireLocalReplicaWrite, cloudTraceRouter);
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
