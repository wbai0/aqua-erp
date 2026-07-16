# 慈德ERP 部署到阿里云函数计算（FC 3.0）

目标：把整套 ERP（Express 后端 + React 前端，一个进程）部署到函数计算，
函数走 **VPC 内网** 连接 ECS 上的 SQL Server 生产库 `cide_main`（只读）。

架构回顾：`server` 用 Express 同时提供 `/api` 并托管 `web/dist` 前端；
数据库是 SQL Server，端口 1433；运行时 `DATA_SOURCE=cloud`、`READ_ONLY=true`。

---

## 你需要先准备的信息

在阿里云控制台查到并填进 `s.yaml`（或控制台表单）：

1. **地域** region：ECS 所在地域，例 `cn-hongkong`。
2. **ECS 的内网 IP**：ECS 实例详情里的「私网 IP」（172.x / 192.168.x），用它替换公网 `8.130.213.6`。
3. **VPC 三件套**：ECS 所在的 `vpcId`、`vSwitchId`、`securityGroupId`（ECS 实例详情可见）。
4. **容器镜像仓库（ACR）**：开通「容器镜像服务」，建一个命名空间和仓库 `cide-erp`。
5. **数据库密码 / JWT_SECRET**。

---

## 步骤一：构建并推送镜像到 ACR

在项目根目录（有 Dockerfile 的地方）执行。注意 FC 容器是 **linux/amd64**，Apple Silicon Mac 要指定平台。

```bash
# 1) 登录 ACR（用你的阿里云账号/RAM 用户）
docker login registry.cn-hongkong.aliyuncs.com

# 2) 构建（Mac M 系列必须加 --platform linux/amd64）
docker build --platform linux/amd64 \
  -t registry.cn-hongkong.aliyuncs.com/<命名空间>/cide-erp:latest .

# 3) 推送
docker push registry.cn-hongkong.aliyuncs.com/<命名空间>/cide-erp:latest
```

> 镜像里已自动：安装 Linux 版 Prisma 引擎、生成两套 Prisma 客户端、构建前后端、
> 并把 generated 客户端补进 dist。密钥不在镜像内。

---

## 步骤二：部署函数（二选一）

### 方式 A：Serverless Devs（推荐，配置即代码）

```bash
npm i -g @serverless-devs/s        # 安装一次
s config add                        # 配置阿里云 AccessKey
# 编辑 s.yaml，把所有 <...> 占位替换好
s deploy
```

### 方式 B：FC 控制台点选

1. 创建函数 → 选「Web 函数」→ 运行环境「容器镜像」。
2. 镜像地址填步骤一推送的镜像；**请求端口填 9000**。
3. 规格：0.5 vCPU / 1GB 起步，超时 60s。
4. 环境变量里加：
   - `DATA_SOURCE=cloud`
   - `READ_ONLY=true`
   - `PORT=9000`
   - `JWT_SECRET=<长随机串>`
   - `CLOUD_DATABASE_URL=sqlserver://<ECS内网IP>:1433;database=cide_main;user=cd;password=<密码>;encrypt=DANGER_PLAINTEXT;trustServerCertificate=true`
5. 网络配置 → 开启 VPC，选 **和 ECS 相同的** VPC / 交换机 / 安全组。
6. 触发器 → 创建 HTTP 触发器，认证方式先用 anonymous。

---

## 步骤三：打通网络（最关键的一步）

函数配了 VPC 还不够，还要让它能访问数据库端口：

1. **ECS 数据库所在安全组** 新增一条入方向规则：
   - 协议 TCP，端口 `1433`，
   - 授权对象填 **函数所用交换机（vSwitch）的网段**（例 `192.168.0.0/24`）。
   - 或者更省事：让函数直接选用与 ECS **相同的安全组**。
2. **SQL Server 要允许远程登录**：账号 `cd` 能从内网登录、TCP/IP 协议已启用、监听 1433。
3. 验证内网通不通：可临时在同 VPC 内另一台 ECS 上 `telnet <ECS内网IP> 1433`。

---

## 步骤四：验证

1. 打开 HTTP 触发器给的公网地址，访问 `/api/health`，应返回：
   ```json
   { "ok": true, "mode": "cloud", "readOnly": true, "database": ... }
   ```
   `mode=cloud` 且能返回 database 信息，说明连库成功。
2. 打开根路径 `/`，应加载 ERP 前端界面并能登录、查数据。

---

## 步骤五：收尾安全加固（内网方案的收益）

确认函数走内网连库正常后：

- **关闭 ECS 安全组里对公网开放的 1433 规则**（原来对 `0.0.0.0/0` 开放的那条），
  让生产库只在 VPC 内网可达，大幅降低被扫库风险。
- 本地开发若仍需连生产，改用跳板机 / VPN，不要再依赖公网 1433。

---

## 常见坑

- **Prisma 引擎报错 `query engine ... not found`**：说明镜像不是在 Linux 构建的，
  或没加 `--platform linux/amd64`。按步骤一重建即可，本仓库 Dockerfile 已处理。
- **冷启动挂网卡有几百毫秒延迟**：对延迟敏感可开「预留实例」常驻。
- **数据库连接被打满**：FC 会按请求横向扩容，实例一多连接数飙升。
  已在 `s.yaml` 用 `instanceConcurrency` 提高单实例并发来压实例数；
  长期建议把自建库迁到 RDS（连法完全一样，同样走 VPC 内网），并配连接池。
- **中文乱码**：生产库应为 `Chinese_PRC_CI_AS` 排序规则（这是库本身的属性，与部署无关）。
