"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "zhiyu_demo";

export default function DemoLoginButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) setHasSession(true);
    } catch {
      // ignore
    }
  }, []);

  async function login() {
    setLoading(true);
    try {
      const resp = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await resp.json()) as {
        ok: boolean;
        userId?: string;
        personaId?: string;
      };
      if (!data.ok || !data.userId || !data.personaId) {
        throw new Error("登录失败");
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId: data.userId, personaId: data.personaId }),
      );
      router.push("/home");
    } catch {
      setLoading(false);
    }
  }

  if (hasSession) {
    return (
      <button className="btn btn-primary" onClick={() => router.push("/home")}>
        进入产品首页
      </button>
    );
  }

  return (
    <button className="btn btn-primary" onClick={login} disabled={loading}>
      {loading ? "正在授权…" : "使用知乎账号登录（演示）"}
    </button>
  );
}
