import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { AppState, Snapshot } from "../domain/types";
import type { SupabaseAdapter } from "../adapters/supabase";
import {
  emptyWorkspace,
  LiveRequestError,
  loadLiveSnapshot,
  loadLiveWorkspace,
  normalizeLiveMutation,
  refreshLiveMutation,
  unwrap,
  type LiveMe,
} from "../adapters/supabase/workspace";
import { canonical } from "../domain/hash";
import { AppContext, type ContextValue } from "./context";

const uuid = () => crypto.randomUUID();
export function LiveWorkspaceProvider({
  adapter,
  onSignOut,
  children,
}: {
  adapter: SupabaseAdapter;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const [data, setData] = useState<AppState>(emptyWorkspace);
  const dataRef = useRef(data);
  dataRef.current = data;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [me, setMe] = useState<LiveMe>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    mounted = useRef(true),
    loaded = useRef(false),
    snapshots = useRef<Snapshot[]>([]);
  const [loadedPath, setLoadedPath] = useState("");
  const loadedPathRef = useRef("");
  const retryKeys = useRef(new Map<string, string>());
  const reload = useCallback(
    async (action?: string, input: Record<string, unknown> = {}) => {
      if (pathname !== pathnameRef.current) return;
      const version = ++generation.current;
      const next = action
        ? await refreshLiveMutation(
            adapter,
            { ...dataRef.current, snapshots: snapshots.current },
            action,
            input,
            pathname,
          )
        : await loadLiveWorkspace(adapter, snapshots.current, pathname);
      if (
        !mounted.current ||
        version !== generation.current ||
        pathname !== pathnameRef.current
      )
        return;
      if (!loaded.current && !next.me.site_ready)
        setNotice(
          "服务端 readiness=false：正式收集尚未准备完成，禁止新建档与发布新实验。M2 仍待真实服务验收。",
        );
      setMe(next.me);
      setData(next.data);
      dataRef.current = next.data;
      setLoadedPath(pathname);
      loadedPathRef.current = pathname;
      snapshots.current = next.data.snapshots;
      loaded.current = true;
      setError("");
    },
    [adapter, pathname],
  );
  const handleFailure = useCallback((failure: unknown) => {
    if (!mounted.current) return;
    const message =
      failure instanceof Error ? failure.message : "无法读取真实服务。";
    if (
      failure instanceof LiveRequestError &&
      ["FORBIDDEN", "UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(
        failure.code,
      )
    ) {
      generation.current++;
      snapshots.current = [];
      retryKeys.current.clear();
      setData(emptyWorkspace());
      setMe(undefined);
      setError(message);
    } else if (loaded.current)
      setNotice(`刷新尚未完成：${message} 当前内容仍保留在页面，请重试读取。`);
    else setError(message);
  }, []);
  const refresh = useCallback(async () => {
    try {
      await reload();
    } catch (failure) {
      handleFailure(failure);
      if (mounted.current && loadedPathRef.current !== pathname)
        setError(
          failure instanceof Error ? failure.message : "无法读取当前真实页面。",
        );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [reload, handleFailure, pathname]);
  useEffect(
    () => () => {
      mounted.current = false;
      generation.current++;
      snapshots.current = [];
      retryKeys.current.clear();
    },
    [],
  );
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const mutate = useCallback(
    async (action: string, input: Record<string, unknown> = {}) => {
      if (["reset", "createIdentity", "listIdentities"].includes(action))
        throw new Error("真实模式不提供演示身份与重置操作。");
      const normalized = normalizeLiveMutation(action, input);
      const fingerprint = action + ":" + canonical(normalized);
      const idempotency_key =
        typeof input.idempotency_key === "string"
          ? input.idempotency_key
          : (retryKeys.current.get(fingerprint) ?? uuid());
      retryKeys.current.set(fingerprint, idempotency_key);
      let result: unknown;
      try {
        result = unwrap(
          await adapter.execute(action, { ...normalized, idempotency_key }),
        );
        if (action !== "createSnapshot") retryKeys.current.delete(fingerprint);
      } catch (failure) {
        if (!(failure instanceof LiveRequestError) || !failure.retryable)
          retryKeys.current.delete(fingerprint);
        if (
          failure instanceof LiveRequestError &&
          ["FORBIDDEN", "UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(
            failure.code,
          )
        )
          handleFailure(failure);
        throw failure;
      }
      if (action === "createSnapshot") {
        const summary = result as { snapshot_id: string };
        const frozen = await loadLiveSnapshot(adapter, summary.snapshot_id);
        snapshots.current = [
          ...snapshots.current.filter(
            (s) => s.snapshot_id !== frozen.snapshot_id,
          ),
          frozen,
        ];
        retryKeys.current.delete(fingerprint);
        result = frozen;
      }
      // A confirmed write remains confirmed even if the following read fails.
      // Keep mounted form input in memory and report refresh failure separately.
      try {
        await reload(action, normalized);
      } catch (failure) {
        handleFailure(failure);
      }
      return result;
    },
    [adapter, reload, handleFailure],
  );
  const signOut = useCallback(async () => {
    generation.current++;
    snapshots.current = [];
    retryKeys.current.clear();
    setData(emptyWorkspace());
    setMe(undefined);
    setNotice("");
    setError("");
    await onSignOut();
  }, [onSignOut]);
  const value: ContextValue = {
    data,
    actor: me,
    identities: [],
    loading: loading || (!error && loadedPath !== pathname),
    error,
    notice,
    setNotice,
    refresh,
    mutate,
    switchActor: async () => {
      throw new Error("真实账户不能切换为演示身份。");
    },
    mode: "live",
    signOut,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
