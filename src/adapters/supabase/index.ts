import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONSENT_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "EXPERIMENT_NOT_OPEN"
  | "ASSIGNMENT_REVOKED"
  | "RESPONSE_LOCKED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "DATA_CHANGED"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INFERENCE_UNAVAILABLE";
export type Result<T> =
  | { ok: true; data: T; request_id: string }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        latest_version?: number;
        field_errors?: { path: string; code: string; message: string }[];
      };
      request_id: string;
    };
export type LiveConfig = {
  url: string;
  publishableKey: string;
  liveOrigin: string;
  storage?: Storage;
};
export type SessionSummary = { user_id: string; email: string | null };
type Input = Record<string, unknown>;
export const AUTH_STORAGE_KEY = "questionnaire:live:unconfigured:auth:v1";
const codes: ErrorCode[] = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "CONSENT_REQUIRED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "EXPERIMENT_NOT_OPEN",
  "ASSIGNMENT_REVOKED",
  "RESPONSE_LOCKED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "DATA_CHANGED",
  "RATE_LIMITED",
  "STORAGE_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "INFERENCE_UNAVAILABLE",
];
const messages: Record<string, string> = {
  UNAUTHENTICATED: "请重新登录。",
  FORBIDDEN: "当前账户无权执行此操作。",
  VALIDATION_FAILED: "输入不符合要求。",
  RATE_LIMITED: "请求过于频繁，请稍后再试。",
  SERVICE_UNAVAILABLE: "真实服务暂时不可用，请稍后重试。",
};
function fail<T>(code: ErrorCode, request_id = crypto.randomUUID()): Result<T> {
  return {
    ok: false,
    error: {
      code,
      message: messages[code] ?? "操作未完成，请检查当前状态。",
      retryable: code === "SERVICE_UNAVAILABLE" || code === "RATE_LIMITED",
    },
    request_id,
  };
}
function mapError<T>(error: unknown): Result<T> {
  const e = error as { status?: number; code?: string; message?: string };
  if (
    e?.status === 429 ||
    e?.code === "over_request_rate_limit" ||
    e?.code === "over_email_send_rate_limit"
  )
    return fail("RATE_LIMITED");
  if (e?.status === 401 || e?.code === "PGRST301" || e?.code === "otp_expired")
    return fail("UNAUTHENTICATED");
  if (e?.status === 403 || e?.code === "42501") return fail("FORBIDDEN");
  return fail("SERVICE_UNAVAILABLE");
}
export const rpcMethods = {
  getMe: "api_get_me",
  completeOnboarding: "api_complete_onboarding",
  listParticipants: "api_list_participants",
  setProfileState: "api_set_profile_state",
  requestDeletion: "api_request_deletion",
  createDraft: "api_create_experiment",
  updateDraft: "api_update_experiment_draft",
  listExperiments: "api_list_experiments",
  getAdminDetail: "api_get_experiment_admin",
  publish: "api_publish_experiment",
  transition: "api_transition_experiment",
  deleteDraft: "api_delete_experiment_draft",
  assign: "api_assign_participants",
  setAssignmentState: "api_set_assignment_state",
  listMyAssignments: "api_list_my_assignments",
  getAssignment: "api_get_assignment",
  acceptNotice: "api_accept_assignment_notice",
  listProgress: "api_list_experiment_progress",
  getResponse: "api_get_response",
  saveDraft: "api_save_response_draft",
  submit: "api_submit_response",
  returnForCorrection: "api_return_response",
  listRevisions: "api_list_response_revisions",
  getRevision: "api_get_response_revision",
  createSnapshot: "api_create_analysis_snapshot",
  getSnapshot: "api_get_analysis_snapshot",
  recordExport: "api_record_export",
} as const;

export class SupabaseAdapter {
  readonly mode = "live" as const;
  constructor(
    private readonly client: SupabaseClient,
    private readonly storage: Storage,
    private readonly onClear: () => void = () => {},
    private readonly storageKey = AUTH_STORAGE_KEY,
  ) {}
  async call<T = unknown>(
    rpc: string,
    p_input: Input = {},
  ): Promise<Result<T>> {
    if (
      !Object.values(rpcMethods).includes(
        rpc as (typeof rpcMethods)[keyof typeof rpcMethods],
      )
    )
      return fail("VALIDATION_FAILED");
    try {
      const { data, error } = await this.client.rpc(rpc, { p_input });
      if (error) return mapError(error);
      if (
        !data ||
        typeof data.ok !== "boolean" ||
        typeof data.request_id !== "string"
      )
        return fail("SERVICE_UNAVAILABLE");
      if (data.ok !== true && (!data.error || !codes.includes(data.error.code)))
        return fail("SERVICE_UNAVAILABLE");
      return data as Result<T>;
    } catch (e) {
      return mapError(e);
    }
  }
  service<T = unknown>(method: keyof typeof rpcMethods, input: Input = {}) {
    return this.call<T>(rpcMethods[method], input);
  }
  execute<T = unknown>(action: string, input: Input = {}): Promise<Result<T>> {
    const method = action === "returnResponse" ? "returnForCorrection" : action;
    if (!(method in rpcMethods)) return Promise.resolve(fail("FORBIDDEN"));
    return this.service<T>(method as keyof typeof rpcMethods, input);
  }
  async getSession(): Promise<Result<SessionSummary | null>> {
    try {
      const { data, error } = await this.client.auth.getUser();
      if (error) {
        if (error.name === "AuthSessionMissingError")
          return { ok: true, data: null, request_id: crypto.randomUUID() };
        return mapError(error);
      }
      return {
        ok: true,
        data: data.user
          ? { user_id: data.user.id, email: data.user.email ?? null }
          : null,
        request_id: crypto.randomUUID(),
      };
    } catch (e) {
      return mapError(e);
    }
  }
  async sendOtp(input: {
    email: string;
    intent: "register" | "login";
  }): Promise<Result<{ message: string }>> {
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      !["register", "login"].includes(input.intent)
    )
      return fail("VALIDATION_FAILED");
    try {
      const { error } = await this.client.auth.signInWithOtp({
        email: input.email.trim(),
        options: { shouldCreateUser: input.intent === "register" },
      });
      // Login to a nonexistent identity must have the same public result as successful delivery.
      if (
        error &&
        !["user_not_found", "signups_not_allowed"].includes(error.code ?? "")
      )
        return mapError(error);
      return {
        ok: true,
        data: { message: "如该邮箱可用于此操作，验证码将发送至邮箱。" },
        request_id: crypto.randomUUID(),
      };
    } catch (e) {
      return mapError(e);
    }
  }
  async verifyOtp(input: {
    email: string;
    token: string;
  }): Promise<Result<SessionSummary>> {
    if (!input.email || !/^\d{6,10}$/.test(input.token))
      return fail("VALIDATION_FAILED");
    try {
      const { data, error } = await this.client.auth.verifyOtp({
        email: input.email.trim(),
        token: input.token,
        type: "email",
      });
      if (error) return mapError(error);
      if (!data.user || !data.session) return fail("UNAUTHENTICATED");
      return {
        ok: true,
        data: { user_id: data.user.id, email: data.user.email ?? null },
        request_id: crypto.randomUUID(),
      };
    } catch (e) {
      return mapError(e);
    }
  }
  async signOut(): Promise<
    Result<{ local_cleared: true; remote_revoked: boolean }>
  > {
    let remote = false;
    try {
      const { error } = await this.client.auth.signOut({ scope: "local" });
      remote = !error;
    } catch {
      /* Local cleanup below remains mandatory when the network is unavailable. */
    } finally {
      try {
        await this.client.auth.signOut({ scope: "local" });
      } catch {
        /* Storage removal is the final fallback. */
      }
      try {
        await this.client.auth.stopAutoRefresh();
      } catch {
        /* Continue local cleanup even if SDK cleanup fails. */
      }
      try {
        this.storage.removeItem(this.storageKey);
        this.storage.removeItem(`${this.storageKey}-code-verifier`);
        this.storage.removeItem(`${this.storageKey}-user`);
      } finally {
        this.onClear();
      }
    }
    return {
      ok: true,
      data: { local_cleared: true, remote_revoked: remote },
      request_id: crypto.randomUUID(),
    };
  }
}
export function createSupabaseAdapter(
  config: LiveConfig,
  onClear?: () => void,
): SupabaseAdapter {
  if (!config.url || !config.publishableKey || !config.liveOrigin)
    throw new Error("真实服务未配置。");
  const service = new URL(config.url);
  const origin = new URL(config.liveOrigin);
  if (
    service.protocol !== "https:" ||
    origin.protocol !== "https:" ||
    origin.hostname.endsWith("github.io")
  )
    throw new Error("真实模式需要独立 HTTPS 托管。");
  if (typeof location !== "undefined" && location.origin !== origin.origin)
    throw new Error("当前来源未获准运行真实模式。");
  if (!config.publishableKey.startsWith("sb_publishable_"))
    throw new Error("仅允许公开 publishable key。");
  const storage = config.storage ?? sessionStorage;
  const storageKey = `questionnaire:live:${service.hostname.split(".")[0]}:auth:v1`;
  const probe = `${storageKey}.probe`;
  storage.setItem(probe, "1");
  storage.removeItem(probe);
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseAdapter(client, storage, onClear, storageKey);
}
