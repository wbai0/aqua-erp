# 慈德 ERP · 库存只读查看端（Web / 移动）

慈德 ERP 库存模块的 Web + 移动端（响应式）**只读查看器**。与现有 Windows 桌面客户端共用同一套业务数据（毛料 / 半成品 / 成品的入库、出库、即时库存、批次溯源），**直连生产库 `cide_main` 只读展示**，不做任何写入。

> ⚠️ **本应用严格只读。** 服务端有硬拦截中间件，除登录外拒绝一切非 GET 请求（详见「只读安全边界」）。这是刻意的：桌面 ERP 的库存/批次逻辑靠单据现算，任何外部写入都会破坏它（背景见 [`docs/库存系统逻辑说明.md`](docs/库存系统逻辑说明.md)）。

## 技术栈

- **前端** React 18 + Vite + TypeScript，Ant Design 5（筛选/表单）+ **AG Grid**（企业级数据表：排序 / 列宽拖拽 / 换列序 / 分页 / 合计行）。
- **后端** Node.js + Express + TypeScript，Prisma 仅作连接驱动（生产库为 SQL Server 2008 R2，手写只读 SQL）。

## 项目结构

```text
cide-erp/
├── server/                       # Express + Prisma(仅 cloud 生成客户端)
│   ├── prisma/
│   │   └── cloud.prisma          # 生产库内省结构(生成 src/generated/cloud 客户端)
│   └── src/
│       ├── index.ts              # 入口 + 只读硬拦截中间件
│       ├── auth.ts               # requireAuth (JWT 校验)
│       ├── env.ts                # 加载 server/.env
│       ├── generated/cloud/      # Prisma 生成的生产库客户端(已提交)
│       └── cloud/
│           ├── router.ts         # 只读业务路由(手写参数化 SQL + ROW_NUMBER 分页)
│           ├── prisma.ts         # 连接生产库的 Prisma 实例
│           └── access.ts         # 数据库标识解析(health 用)
├── web/                          # React + Vite + AntD + AG Grid
│   └── src/{pages, components, api.ts, App.tsx}
├── docs/库存系统逻辑说明.md         # 桌面 ERP 库存/批次内在逻辑梳理(务必先读)
├── Dockerfile / .dockerignore    # 容器化部署
├── DEPLOY.md / s.yaml            # 部署说明 / Serverless Devs(阿里云 FC)配置
```

## 环境配置

凭据只放在 `server/.env`（已被 Git 忽略，**切勿**写入源码/README/提交记录）：

```dotenv
PORT=3001
JWT_SECRET="<自定义随机串>"
READ_ONLY=true                    # 只读硬拦截(默认开启;设 false 才允许写,不建议对生产)
CLOUD_DATABASE_URL="sqlserver://<生产主机>:1433;database=cide_main;user=<用户>;password=<密码>;encrypt=DANGER_PLAINTEXT;trustServerCertificate=true"
```

登录使用生产库 `t_a_personnel` 里的真实账号密码（桌面端同一套）。登录 token 存浏览器 `localStorage`，7 天有效。

## 本地运行

```bash
npm install                       # 根目录(npm workspaces)
npm run dev                       # 同时起 API 与 Web
```

- API：<http://localhost:3001> · 健康检查 <http://localhost:3001/api/health>
- Web：<http://localhost:5173>

生产部署：`cd web && npm run build` 生成前端产物，服务端 `npm run build -w server && npm run start -w server` 会同时托管 `web/dist` 与 API。容器化见 `DEPLOY.md`。

需要在生产库结构变化后重新生成 Prisma 客户端时：`npm run cloud:generate -w server`（读 `prisma/cloud.prisma`，只读内省，不改库）。

## 只读安全边界

- `server/src/index.ts` 注册全局中间件：`READ_ONLY` 开启时，除 `POST /api/auth/login` 外，**任何非 GET/HEAD/OPTIONS 请求一律 403**。
- 服务端不注册任何写路由（无新增/修改/删除/审核）。前端也据 `capabilities.canWriteDocs=false` 隐藏所有写操作入口。
- `/api/health` 会返回 `{ readOnly: true, database }`，页面顶部显示当前连接的数据库标识，便于核对。

## 核心业务逻辑（要点）

> 完整梳理见 [`docs/库存系统逻辑说明.md`](docs/库存系统逻辑说明.md)。

- **库存靠单据现算，不看审核状态。** 即时库存 = 该物料 `Σ入库明细 − Σ出库明细`（含未审核单据）。桌面端正常运行时 `t_stock_material` / `t_material_batch` 的数量字段长期为 0，不作为库存来源。
- **批次结余靠明细的 `material_batch_id` 现算**（复刻生产库函数 `f_get_material_batch_id_in_quantity` / `_in_used_quantity`）：批次入库量 − 已领用量。
- **物料编码 = `类别.供应商.序号`**（如 `BCP.WXF.001`：BCP 半成品、WXF 供应商）。供应商即从编码第二段解析。
- **两种出库**：生产出库按批次（`material_batch_id`），毛料出库按入库单（`in_detail`）。
- **检索码 `s_code`** 贯穿「毛料 → 半成品 → 成品」全链路，用于批次溯源。

生产库为较旧的 SQL Server，不支持 `OFFSET/FETCH`，故 `cloud/router.ts` 使用参数化手写 SQL 与 `ROW_NUMBER()` 分页。

## API（全部只读，登录除外）

| 接口 | 说明 |
|---|---|
| `POST /api/auth/login` | 登录（唯一放行的写方法） |
| `GET /api/masters/meta` | 仓库 / 供应商 / 客户 / 物料 / 产地 / 单位 / 单据类型 等基础数据 |
| `GET /api/dashboard` | 工作台聚合：分类库存、在库品种、今日/近7天出入库动态 |
| `GET /api/inventory` | 即时库存（支持 `byBatch` 及供应商/产地/仓库/类别多选、物料搜索的服务端筛选） |
| `GET /api/documents` / `GET /api/documents/:id` | 单据列表 / 详情 |
| `GET /api/trace` | 按检索码 / 批次 / 车次溯源 |
| `GET /api/health` | 服务状态、只读标志、当前数据库 |

## 前端页面

- **工作台**：分类库存总量、在库品种、今日/近7天出入库、溯源直达、最近单据。
- **即时库存**：AG Grid 高密度表 + 顶部 antd 多选筛选（服务端查询）+ 底部按单位合计。
- **单据管理**：入库/出库/盘点分组（左侧菜单按类型铺开），AG Grid 列表 + 筛选；点击进详情。
- **批次溯源**：按检索码/车次查看全链路出入库事件。
- 桌面端左侧导航 + 移动端底部导航,响应式。

## 关键约束

- 该端**只读**，不承担任何库存写入/审核；一切修改仍在桌面 ERP 完成。
- 生产部署建议：API 在受限网络内连库，数据库不暴露公网，对外仅暴露 HTTPS API。
- 生产连接使用老版 SQL Server 的 `encrypt=DANGER_PLAINTEXT`（TLS 1.0），迁移到 RDS 后应改为正常加密。
