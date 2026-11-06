import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSupabaseAdapter,
  type LiveConfig,
  type Result,
  type SessionSummary,
} from "../adapters/supabase";
import { LiveWorkspaceProvider } from "./live-workspace";
import { Shell } from "./App";

interface Me {
  user_id: string;
  display_name: string;
  participant_code: string;
  role: "admin" | "participant";
  state: string;
  site_ready: boolean;
  site_notice_version: string;
  site_notice: Record<string, unknown>;
}
export function LiveApp({ config }: { config?: LiveConfig }) {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [intent, setIntent] = useState<"register" | "login">("login");
  const [nickname, setNickname] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const connection = useMemo(() => {
    try {
      return {
        adapter: createSupabaseAdapter(
          config ?? {
            url: import.meta.env.VITE_SUPABASE_URL ?? "",
            publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
            liveOrigin: import.meta.env.VITE_LIVE_ORIGIN ?? "",
          },
          () => {
            generation.current++;
            setMe(null);
            setSession(null);
            setEmail("");
            setToken("");
            setAccepted(false);
          },
        ),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "真实服务未配置。" };
    }
  }, [config]);
  const adapter = connection.adapter;
  function showError(result: Result<unknown>): boolean {
    if (result.ok) return false;
    setMessage(
      `${result.error.message}（${result.error.code}，请求号 ${result.request_id}）`,
    );
    return true;
  }
  async function loadMe() {
    if (!adapter) return;
    const currentGeneration = generation.current;
    const result = await adapter.service<Me>("getMe");
    if (
      currentGeneration !== generation.current ||
      showError(result) ||
      !result.ok
    )
      return;
    setMe(result.data);
    setNickname(result.data.display_name);
  }
  useEffect(() => {
    let alive = true;
    if (!adapter) return;
    void (async () => {
      setBusy(true);
      const result = await adapter.getSession();
      if (!alive) return;
      if (!showError(result) && result.ok) {
        setSession(result.data);
        if (result.data) await loadMe();
      }
      if (alive) setBusy(false);
    })();
    return () => {
      alive = false;
      generation.current++;
    };
  }, [adapter]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage("真实服务暂时不可用，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  if (session && me?.state === "active" && adapter)
    return (
      <LiveWorkspaceProvider
        adapter={adapter}
        onSignOut={async () => {
          const result = await adapter.signOut();
          if (result.ok)
            setMessage(
              result.data.remote_revoked
                ? "已退出，当前浏览器会话与页面账户数据已清理。"
                : "本地会话已清理；远端撤销未确认，其他设备可能仍保持登录。",
            );
          else showError(result);
        }}
      >
        <Shell live />
      </LiveWorkspaceProvider>
    );
  return (
    <main
      className="live-app"
      style={{
        maxWidth: 850,
        margin: "auto",
        padding: "40px 24px",
        lineHeight: 1.7,
      }}
    >
      <p>
        <strong>真实模式 · M2 接入待验收</strong>
      </p>
      <h1>真实服务账户与连接</h1>
      <p>
        真实账户由 Supabase Auth
        验证。登录建档后使用已授权的实验、任务、答卷及分析工作区。此入口尚未完成正式收集验收，业务失败会保留为失败状态。
      </p>
      {connection.error ? (
        <section role="alert">
          <h2>真实服务尚未配置</h2>
          <p>{connection.error}</p>
          <p>
            需要独立 HTTPS 托管、Supabase 项目、公开 publishable key、自定义
            SMTP 与真实负责人隐私配置。配置方法见仓库的 docs/live-setup.md。
          </p>
        </section>
      ) : (
        <>
          {!session ? (
            <section>
              <h2>邮箱验证码</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const result = await adapter!.sendOtp({ email, intent });
                    if (result.ok) setMessage(result.data.message);
                    else showError(result);
                  });
                }}
              >
                <label>
                  操作{" "}
                  <select
                    value={intent}
                    onChange={(e) =>
                      setIntent(e.target.value as "login" | "register")
                    }
                    disabled={busy}
                  >
                    <option value="login">登录现有账户</option>
                    <option value="register">注册新账户</option>
                  </select>
                </label>
                <br />
                <label>
                  邮箱{" "}
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy}
                  />
                </label>{" "}
                <button disabled={busy}>发送验证码</button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const result = await adapter!.verifyOtp({ email, token });
                    setToken("");
                    if (result.ok) {
                      setSession(result.data);
                      await loadMe();
                    } else showError(result);
                  });
                }}
              >
                <label>
                  验证码{" "}
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    disabled={busy}
                  />
                </label>{" "}
                <button disabled={busy}>验证并登录</button>
              </form>
            </section>
          ) : (
            <section>
              <h2>当前真实账户</h2>
              <p>{session.email}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await adapter!.signOut();
                    if (result.ok)
                      setMessage(
                        result.data.remote_revoked
                          ? "已退出，当前浏览器会话与页面账户数据已清理。"
                          : "本地会话已清理；远端撤销未确认，其他设备可能仍保持登录。",
                      );
                    else showError(result);
                  })
                }
              >
                退出并清理页面数据
              </button>{" "}
              <button disabled={busy} onClick={() => void run(loadMe)}>
                重新检查账户
              </button>
              {me && (
                <>
                  <p>
                    评价员代号：{me.participant_code} · 角色：
                    {me.role === "admin" ? "管理员" : "评价员"} · 状态：
                    {me.state}
                  </p>
                  {!me.site_ready && (
                    <p role="alert">
                      服务端
                      readiness=false：负责人、隐私策略、运维或验收尚未准备完成。当前禁止完成建档和发布新实验，不具备正式收集条件。
                    </p>
                  )}
                  <section>
                    <h2>站点告知</h2>
                    {Object.entries(me.site_notice ?? {}).map(([k, value]) => (
                      <p key={k}>
                        <strong>{k}</strong>：
                        {typeof value === "string"
                          ? value
                          : JSON.stringify(value)}
                      </p>
                    ))}
                    <p>告知版本：{me.site_notice_version || "未配置"}</p>
                  </section>
                  {me.state === "pending_consent" && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          if (!accepted) return;
                          const result = await adapter!.service(
                            "completeOnboarding",
                            {
                              display_name: nickname,
                              consent_version: me.site_notice_version,
                              idempotency_key: crypto.randomUUID(),
                            },
                          );
                          if (!showError(result)) await loadMe();
                        });
                      }}
                    >
                      <label>
                        昵称{" "}
                        <input
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          maxLength={100}
                          required
                          disabled={busy}
                        />
                      </label>
                      <br />
                      <label>
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(e) => setAccepted(e.target.checked)}
                          disabled={busy || !me.site_ready}
                        />
                        我已阅读并接受上述站点告知
                      </label>{" "}
                      <button disabled={busy || !accepted || !me.site_ready}>
                        完成建档
                      </button>
                    </form>
                  )}
                </>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await adapter!.service<{
                      request_id: string;
                      status: string;
                    }>("requestDeletion", {
                      reason:
                        "本人通过真实账户申请数据删除，请负责人核验处理。",
                      idempotency_key: crypto.randomUUID(),
                    });
                    if (result.ok)
                      setMessage(
                        `删除申请已提交，编号 ${result.data.request_id}，状态 ${result.data.status}。申请提交不表示数据已删除。`,
                      );
                    else showError(result);
                  })
                }
              >
                提交本人数据删除申请
              </button>
            </section>
          )}
        </>
      )}
      {busy && <p role="status">正在请求真实服务…</p>}
      {message && (
        <p role="status" style={{ whiteSpace: "pre-wrap" }}>
          {message}
        </p>
      )}
    </main>
  );
}
export default LiveApp;
