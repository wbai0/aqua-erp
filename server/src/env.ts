import path from "path";
import dotenv from "dotenv";

// source (src/) 和编译产物 (dist/) 都从 server/.env 加载配置，
// 不依赖启动命令的当前工作目录。
dotenv.config({ path: path.resolve(__dirname, "../.env") });
