# 慈德 ERP Web / 移动客户端

慈德 ERP 的 Web + 移动端（PWA）客户端，与现有 Windows 桌面客户端使用同一套业务概念，覆盖毛料、半成品和成品的入库、出库、盘点、即时库存与批次溯源。

日常开发使用生产数据库结构的本地副本 `cide_main_dev`。远端生产数据库 `cide_main` 只允许查询，不允许通过本项目执行任何业务写入。

## 项目结构

```text
cide-erp/
├── server/                         # Node.js + TypeScript + Express + Prisma
│   ├── prisma/
│   │   ├── schema.prisma           # 早期简化开发账套 cide_erp
│   │   ├── cloud.prisma            # 生产库内省结构（约 182 张表）
│   │   ├── cloud.replica.prisma    # 自动生成，本地副本建表使用
│   │   ├── seed.ts                 # 简化账套种子
│   │   └── seed-cloud.ts           # 真实结构副本种子
│   ├── scripts/
│   │   ├── make-replica-schema.ts  # 生成可用于本地建表的 schema
│   │   ├── sync-from-remote.ts      # 生产库只读 → 本地副本写入
│   │   └── schema-check.ts          # 对比生产库结构
│   └── src/
│       ├── cloud/                   # 真实生产表结构路由及副本写入逻辑
│       └── routes/                  # 简化账套路由
├── web/                             # React + Vite + Ant Design 响应式 PWA
├── docker-compose.yml               # 本地 SQL Server 2022
└── package.json                     # npm workspaces
```

## 数据源与安全边界

服务端由 `DATA_SOURCE` 选择数据模型：

| DATA_SOURCE | 连接变量 | 用途 | 写入权限 |
|---|---|---|---|
| `local` | `DATABASE_URL` | 早期简化账套 `cide_erp` | 可读写 |
| `cloud` | `CLOUD_DATABASE_URL` 指向 localhost | 真实结构本地副本 `cide_main_dev` | 可读写 |
| `cloud` | `CLOUD_DATABASE_URL` 指向远端主机 | 远端生产库 `cide_main` | 全部业务接口只读 |

cloud 模式采用统一写入保护：除登录接口外，所有业务 API 的非只读 HTTP 请求都经过同一个中间件。只有连接主机明确为 `localhost`、`127.0.0.1` 或 `::1` 时才允许写入；连接串缺失、格式无法识别或指向其他主机时一律返回 `403`。

因此，切换 `CLOUD_DATABASE_URL` 会同时切换单据、审核、供应商、客户、物料、产地和包装物等全部写入能力，不存在部分接口仍写向生产库的例外。

远端连接凭据只应保存在 `server/.env`，该文件已被 Git 忽略。不要把生产连接串写入源码、README 或提交记录。

## 本地开发

### 1. 启动 SQL Server

```bash
docker compose up -d
docker exec cide-erp-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P '<本地 SA 密码>' -C \
  -Q "CREATE DATABASE cide_main_dev COLLATE Chinese_PRC_CI_AS"
```

Apple Silicon Mac 需要在 Docker Desktop 中启用 x86_64/amd64 仿真。数据库必须使用 `Chinese_PRC_CI_AS`，否则部分中文数据可能写成 `??`。

### 2. 安装依赖并配置环境

```bash
npm install
cp server/.env.example server/.env
```

推荐的开发配置：

```dotenv
DATA_SOURCE=cloud
CLOUD_DATABASE_URL="sqlserver://localhost:1433;database=cide_main_dev;user=sa;password=<本地密码>;trustServerCertificate=true"
```

`server/src/index.ts` 会在启动时自动加载 `server/.env`。

### 3. 初始化真实结构副本

只需要演示数据时：

```bash
npm run replica:push -w server
npm run replica:seed -w server
```

需要复制生产数据时，先配置只读的 `REMOTE_DATABASE_URL`，然后执行：

```bash
npm run replica:push -w server
npm run replica:sync -w server
```

`replica:sync` 对远端只执行 `SELECT`，所有删除和写入只发生在 localhost 副本。同步会清空本地表，不要把 `CLOUD_DATABASE_URL` 指向需要保留数据的数据库。

默认跳过日志、历史临时表以及超过 200,000 行的表。可通过 `SYNC_MAX_ROWS` 调整上限，或使用 `SYNC_ALL=1` 包含默认跳过的表。

### 4. 启动项目

```bash
npm run dev
```

- API：<http://localhost:3001>
- Web：<http://localhost:5173>
- 健康检查：<http://localhost:3001/api/health>

手机与开发机位于同一局域网时，可访问 `http://<开发机IP>:5173`。

## 生产库结构与关键表

生产表结构通过 `prisma db pull` 内省保存到 `server/prisma/cloud.prisma`。主要映射如下：

| 业务对象 | 生产表 | 说明 |
|---|---|---|
| 入库单 | `t_stock_in` | 状态、仓库、车次、制单与审核信息 |
| 入库明细 | `t_stock_in_detail` | 物料、数量、检索码、批次、产地、供应商 |
| 出库单 | `t_stock_out` | 与入库单结构对称 |
| 出库明细 | `t_stock_out_detail` | 出库物料和批次信息 |
| 仓库 | `t_a_stock` | 仓库主数据 |
| 物料 | `t_a_material` | 物料编码、名称、类型和单位 |
| 供应商 | `t_a_supplier` | 供应商主数据 |
| 客户 | `t_a_cust` | 客户主数据 |
| 用户 | `t_a_personnel` | 登录、制单人与审核人 |
| 即时库存 | `t_stock_material` | 按仓库和物料维护的库存值 |
| 批次库存 | `t_material_batch` | 批次入库量、出库量和剩余量 |
| 库存流水 | `t_m_stock_journal` | 出入库流水 |
| 单据类型 | `t_a_in_type` / `t_a_out_type` | 入库和出库类型字典 |

远端 SQL Server 版本较旧，不支持 `OFFSET/FETCH`。`server/src/cloud/router.ts` 因此使用参数化手写 SQL 和 `ROW_NUMBER()` 分页，Prisma 在这条路径中主要作为连接驱动与类型化写入客户端。

## 单据流程

支持的基础流程为：

```text
未审核 → 审核 → 已审核 → 取消审核 → 未审核
```

本地副本支持：

- 新建、修改、删除未审核单据
- 审核与取消审核
- 维护 `t_stock_material`
- 创建入库批次
- 出库时按 FIFO 模拟扣减 `t_material_batch`
- 新增供应商、客户、物料、产地和包装物

生产库没有用于维护库存的触发器，实际库存逻辑位于旧桌面客户端。当前副本审核实现仅供开发和演示，尚未完整复刻桌面端行为，尤其没有完整覆盖 `t_m_stock_journal` 等关联表。

在测试账套中完成桌面端审核前后全库快照对比、确认取号规则并校正所有库存关联表之前，禁止开放远端生产写入。

## 数据库维护命令

在仓库根目录执行：

```bash
# 简化账套
npm run db:push
npm run db:seed

# 真实结构本地副本
npm run replica:push -w server
npm run replica:seed -w server
npm run replica:sync -w server

# 只读检查生产 schema 是否变化
npm run schema:check -w server
```

`schema:check` 使用 `REMOTE_DATABASE_URL` 对生产库执行只读内省。一致时输出成功信息；有差异时列出摘要，并把完整远端结构写入系统临时目录，不会直接覆盖项目 schema。

## API 与前端功能

主要接口：

- `/api/auth/login`：登录
- `/api/masters/meta`：仓库、物料、单位和单据类型等基础数据
- `/api/documents`：单据查询与副本写入
- `/api/inventory`：即时库存和批次库存
- `/api/trace`：按检索码、批次或车次溯源
- `/api/health`：服务状态与当前数据模式

前端包含工作台、单据列表和表单、库存查询、批次溯源以及桌面/移动端响应式导航。登录 token 当前保存在浏览器 `localStorage`，有效期为 7 天。

## 当前限制与后续工作

- 确认生产单据 ID 的正式取号逻辑，重点检查 `t_e_counter`、`t_e_ordinal` 等表。
- 在隔离测试账套中对比桌面端审核前后数据库快照，完整复刻库存和流水维护逻辑。
- 改进混合入库/出库列表的全局分页。
- 增加数据库同步中断后的约束恢复和完整性校验。
- 完善用户权限、离线录单、Excel 导出和部署方案。
- 生产部署时由 API 在受限网络内连接数据库，关闭数据库公网端口，对外仅暴露 HTTPS API。
