import { useState } from "react";
import { Button, Form, Input, message } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const res = await api<{ token: string; user: any }>("/auth/login", {
        method: "POST",
        body: values,
      });
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "linear-gradient(160deg, #001529 0%, #002c66 60%, #0958d9 130%)",
      }}
    >
      <div style={{ width: 380, maxWidth: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28, color: "#fff" }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 12, background: "#0958d9",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 700, marginBottom: 12, letterSpacing: 2,
              boxShadow: "0 4px 16px rgba(9,88,217,0.5)",
            }}
          >
            慈德
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>慈德ERP 仓储管理</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
            海南慈德高科技渔业有限公司
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: 10, padding: "28px 28px 20px", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
          <Form layout="vertical" onFinish={onFinish} size="large">
            <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input prefix={<UserOutlined style={{ color: "#bbb" }} />} autoCapitalize="characters" autoComplete="username" placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password prefix={<LockOutlined style={{ color: "#bbb" }} />} autoComplete="current-password" placeholder="密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 44 }}>
              登 录
            </Button>
          </Form>
          <div style={{ textAlign: "center", color: "#bbb", fontSize: 12, marginTop: 14 }}>
            与桌面客户端使用相同的账号密码
          </div>
        </div>
      </div>
    </div>
  );
}
