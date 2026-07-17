@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 慈德ERP 只读查看端 (production)

REM ============================================================
REM  生产启动：安装依赖 -> 生成 Prisma 客户端 -> 打包前端 -> 起服务
REM  服务在单端口(默认 3001)同时托管 web/dist 与 API。
REM  记得：安全组/Windows防火墙放行该端口；数据库端口不要对公网开放。
REM ============================================================

if not exist "server\.env" (
  echo [ERROR] 缺少 server\.env
  echo   请先在 server\ 下创建 .env，至少包含 CLOUD_DATABASE_URL / JWT_SECRET / PORT / READ_ONLY
  echo   参考 README.md 的「环境配置」。
  exit /b 1
)

echo == [1/4] 安装依赖 ==
call npm install || goto :fail

echo == [2/4] 生成 Prisma 生产库客户端(按本机平台) ==
call npm run cloud:generate -w server || goto :fail

echo == [3/4] 打包前端(vite build -> web\dist) ==
call npm run build -w web || goto :fail

echo == [4/4] 启动服务(托管 web\dist + API) ==
echo     打开浏览器访问  http://本机IP:%PORT%   (PORT 未设时默认 3001)
call npm run serve -w server
goto :eof

:fail
echo.
echo [启动失败] 上一步返回了错误，请看上方日志。
exit /b 1
