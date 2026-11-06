import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { AppState, Profile } from "../domain/types";
import { DemoAdapter } from "../adapters/demo";
export const uid = () => crypto.randomUUID();
export const when = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Shanghai",
      }).format(new Date(value))
    : "不限";
export const statusLabel: Record<string, string> = {
  draft: "草稿",
  published: "进行中",
  closed: "已关闭",
  archived: "已归档",
  submitted: "已提交",
  returned: "已退回",
  active: "已激活",
  disabled: "已停用",
  revoked: "已撤销",
  pending_consent: "待建档",
};
const blank: AppState = {
  profiles: [],
  experiments: [],
  assignments: [],
  responses: [],
  revisions: [],
  snapshots: [],
  audit_events: [],
};
export type ContextValue = {
  data: AppState;
  actor: Profile | undefined;
  identities: Profile[];
  loading: boolean;
  error: string;
  notice: string;
  setNotice: (s: string) => void;
  refresh: () => Promise<void>;
  mutate: (action: string, input?: Record<string, unknown>) => Promise<any>;
  switchActor: (id: string) => Promise<void>;
  mode?: "demo" | "live";
  signOut?: () => Promise<void>;
};
export const AppContext = createContext<ContextValue>(null!);
export function Provider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(blank),
    [identities, setIdentities] = useState<Profile[]>([]),
    [actorId, setActorId] = useState(
      () =>
        sessionStorage.getItem("questionnaire:demo:identity:v1") ??
        "demo-admin",
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const adapter = useRef(new DemoAdapter(actorId));
  const refresh = useCallback(async () => {
    try {
      const next = await adapter.current.read();
      setData(next);
      setError("");
      const all = await adapter.current.execute("listIdentities", {});
      if (all.ok) setIdentities(all.data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "无法读取本浏览器数据，请重试。",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void adapter.current
      .initialize()
      .then(refresh)
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
    const channel = new BroadcastChannel("questionnaire:demo:v1");
    channel.onmessage = () => void refresh();
    return () => channel.close();
  }, [refresh]);
  const mutate = useCallback(
    async (action: string, input: Record<string, unknown> = {}) => {
      const r = await adapter.current.execute(action, {
        ...input,
        idempotency_key: input.idempotency_key ?? uid(),
      });
      if (!r.ok) {
        const failure = new Error(
          r.error.message +
            (r.error.field_errors?.length
              ? "\n" +
                r.error.field_errors
                  .map((i) => i.path + "：" + i.message)
                  .join("\n")
              : ""),
        );
        Object.assign(failure, { code: r.error.code });
        throw failure;
      }
      await refresh();
      const ch = new BroadcastChannel("questionnaire:demo:v1");
      ch.postMessage("changed");
      ch.close();
      return r.data;
    },
    [refresh],
  );
  async function switchActor(id: string) {
    adapter.current.setActor(id);
    sessionStorage.setItem("questionnaire:demo:identity:v1", id);
    setActorId(id);
    await refresh();
  }
  return (
    <AppContext.Provider
      value={{
        mode: "demo",
        data,
        identities,
        actor: data.profiles.find((p) => p.user_id === actorId),
        loading,
        error,
        notice,
        setNotice,
        refresh,
        mutate,
        switchActor,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
export const useApp = () => useContext(AppContext);
