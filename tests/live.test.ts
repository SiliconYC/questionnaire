import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  AUTH_STORAGE_KEY,
  createSupabaseAdapter,
  rpcMethods,
  SupabaseAdapter,
} from "../src/adapters/supabase";
import {
  allPages,
  loadLiveSnapshot,
  loadLiveWorkspace,
  normalizeLiveMutation,
  refreshLiveMutation,
  type LiveService,
} from "../src/adapters/supabase/workspace";
import example from "../docs/examples/experiment-valid.json";

function setup() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (k) => values.get(k) ?? null,
    key: (i) => [...values.keys()][i] ?? null,
    removeItem: (k) => {
      values.delete(k);
    },
    setItem: (k, v) => {
      values.set(k, v);
    },
  };
  const auth = {
    getUser: vi.fn(),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    stopAutoRefresh: vi.fn(),
  };
  const client = { auth, rpc: vi.fn() };
  const clear = vi.fn();
  mocks.createClient.mockReturnValue(client);
  const adapter = new SupabaseAdapter(client as never, storage, clear);
  return { adapter, client, auth, storage, clear };
}
beforeEach(() => vi.clearAllMocks());
describe("live adapter (mock SDK; no real Supabase acceptance)", () => {
  it("uses only dedicated session storage with the official SDK", () => {
    const { storage } = setup();
    createSupabaseAdapter({
      url: "https://test.supabase.co",
      publishableKey: "sb_publishable_example",
      liveOrigin: "https://study.example.org",
      storage,
    });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "sb_publishable_example",
      {
        auth: {
          storage,
          storageKey: "questionnaire:live:test:auth:v1",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
  });
  it("fails closed on missing configuration, secret keys and Pages origin", () => {
    const { storage } = setup();
    for (const config of [
      { url: "", publishableKey: "", liveOrigin: "" },
      {
        url: "https://test.supabase.co",
        publishableKey: "sb_secret_forbidden",
        liveOrigin: "https://study.example.org",
      },
      {
        url: "https://test.supabase.co",
        publishableKey: "sb_publishable_example",
        liveOrigin: "https://example.github.io",
      },
    ])
      expect(() => createSupabaseAdapter({ ...config, storage })).toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("distinguishes registration and login without disclosing missing users", async () => {
    const { adapter, auth } = setup();
    await adapter.sendOtp({ email: "person@example.org", intent: "register" });
    expect(auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: "person@example.org",
      options: { shouldCreateUser: true },
    });
    auth.signInWithOtp.mockResolvedValue({ error: { code: "user_not_found" } });
    expect(
      (await adapter.sendOtp({ email: "person@example.org", intent: "login" }))
        .ok,
    ).toBe(true);
    expect(auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: "person@example.org",
      options: { shouldCreateUser: false },
    });
  });
  it("exposes only a verified user summary, never session tokens", async () => {
    const { adapter, auth } = setup();
    auth.verifyOtp.mockResolvedValue({
      data: {
        user: { id: "user", email: "p@example.org" },
        session: { access_token: "secret" },
      },
      error: null,
    });
    const result = await adapter.verifyOtp({
      email: "p@example.org",
      token: "123456",
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: "p@example.org",
      token: "123456",
      type: "email",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { user_id: "user", email: "p@example.org" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    auth.getUser.mockResolvedValue({
      data: { user: { id: "user", email: "p@example.org" } },
      error: null,
    });
    expect((await adapter.getSession()).ok).toBe(true);
    expect(auth.getUser).toHaveBeenCalled();
  });
  it("clears local storage and user memory even when remote signout fails", async () => {
    const { adapter, auth, storage, clear } = setup();
    storage.setItem(AUTH_STORAGE_KEY, "token");
    auth.signOut.mockRejectedValue(new Error("network"));
    expect(await adapter.signOut()).toMatchObject({
      ok: true,
      data: { local_cleared: true, remote_revoked: false },
    });
    expect(storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(clear).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(auth.signOut).not.toHaveBeenCalledWith({ scope: "global" });
  });
  it("clears the configured project session namespace without clearing another project", async () => {
    const { storage, auth } = setup();
    const adapter = createSupabaseAdapter({
      url: "https://studyproject.supabase.co",
      publishableKey: "sb_publishable_example",
      liveOrigin: "https://study.example.org",
      storage,
    });
    storage.setItem("questionnaire:live:studyproject:auth:v1", "own-token");
    storage.setItem("questionnaire:live:otherproject:auth:v1", "other-token");
    await adapter.signOut();
    expect(
      storage.getItem("questionnaire:live:studyproject:auth:v1"),
    ).toBeNull();
    expect(storage.getItem("questionnaire:live:otherproject:auth:v1")).toBe(
      "other-token",
    );
    expect(auth.signOut).not.toHaveBeenCalledWith({ scope: "global" });
  });
  it("sends p_input unchanged and preserves conflict details without retrying", async () => {
    const { adapter, client } = setup();
    const input = {
      assignment_id: "a",
      expected_version: 3,
      idempotency_key: "key",
    };
    const result = {
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        latest_version: 4,
        message: "conflict",
        retryable: false,
      },
      request_id: "server-request",
    };
    client.rpc.mockResolvedValue({ data: result, error: null });
    expect(await adapter.execute("submit", input)).toEqual(result);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("api_submit_response", {
      p_input: input,
    });
  });
  it("sanitizes provider errors and rejects unsupported/demo operations", async () => {
    const { adapter, client } = setup();
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "SQL secret detail" },
    });
    const result = await adapter.service("getMe");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SERVICE_UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("SQL");
    expect(await adapter.execute("reset")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await adapter.call("unknown")).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
  });
});

describe("migration delivery safeguards (static inspection only)", () => {
  const dir = resolve("supabase/migrations");
  const files = readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort();
  const sql = files
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .join("\n");
  it("implements every documented adapter RPC with authenticated-only wrappers", () => {
    for (const name of Object.values(rpcMethods)) {
      expect(sql).toContain(`create function public.${name}(p_input jsonb`);
      expect(sql).toContain(
        `revoke all on function public.${name}(jsonb) from public, anon`,
      );
      expect(sql).toContain(
        `grant execute on function public.${name}(jsonb) to authenticated`,
      );
    }
  });
  it("keeps tables private with RLS, fails readiness closed and provides trusted cleanup", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("ready boolean not null default false");
    expect(sql).toContain("app_private.fulfill_deletion");
    expect(sql).toContain("app_private.purge_experiment");
    expect(sql).toContain("delete from app_private.analysis_snapshots");
    expect(sql).toContain("pg_advisory_xact_lock(721931,1)");
    expect(sql).not.toMatch(
      /grant\s+(?:all|insert|update|delete|select)\b[^;]+\bto\s+(?:anon|authenticated)/i,
    );
    for (const def of sql.matchAll(/create function[\s\S]*?as \$\$/g))
      expect(def[0]).toContain("set search_path=''");
  });
});

describe("live workspace DTO integration (mock services)", () => {
  const profile = {
    user_id: "person",
    display_name: "Participant",
    participant_code: "P-person",
    role: "participant",
    state: "active",
    edit_version: 2,
    site_ready: true,
    site_notice_version: "notice",
    site_notice: {},
  };
  const publicConfig = {
    ...example,
    samples: example.samples.map((s) => ({
      sample_id: s.sample_id,
      code: s.code,
    })),
  };
  const experiment = {
    experiment_id: "exp",
    status: "published",
    config_version_id: "cfg",
    created_at: "2026-11-06T00:00:00Z",
    published_at: "2026-11-06T00:00:00Z",
    closed_at: null,
    edit_version: 2,
    data_revision: 4,
  };
  const assignment = {
    assignment_id: "assignment",
    experiment_id: "exp",
    user_id: "person",
    config_version_id: "cfg",
    state: "active",
    edit_version: 1,
    consented_at: "2026-11-06T01:00:00Z",
    privacy_notice_version: "notice",
    created_at: "2026-11-06T00:00:00Z",
  };
  function serviceFrom(
    handler: (method: string, input: Record<string, unknown>) => unknown,
  ) {
    const fn = vi.fn(
      async (method: string, input: Record<string, unknown> = {}) => ({
        ok: true,
        data: handler(method, input),
        request_id: "mock-request",
      }),
    );
    return { service: fn } as unknown as LiveService & { service: typeof fn };
  }
  it("traverses every page and rejects repeated cursors", async () => {
    const service = serviceFrom((_, input) =>
      input.cursor === null
        ? { items: [1], next_cursor: "second" }
        : { items: [2], next_cursor: null },
    );
    expect(await allPages(service, "listMyAssignments")).toEqual([1, 2]);
    expect(service.service).toHaveBeenCalledTimes(2);
    const broken = serviceFrom(() => ({ items: [], next_cursor: "same" }));
    await expect(allPages(broken, "listMyAssignments")).rejects.toThrow(
      "重复游标",
    );
  });
  it("loads only the participant own projected tasks, answers and immutable revisions", async () => {
    const answers = { numeric: [], text: [] };
    const service = serviceFrom((method) => {
      switch (method) {
        case "getMe":
          return profile;
        case "listMyAssignments":
          return { items: [assignment], next_cursor: null };
        case "getAssignment":
          return {
            ...assignment,
            config: publicConfig,
            experiment,
            responses: [
              {
                sample_id: "s_a",
                response_id: "response",
                state: "submitted",
                edit_version: 4,
              },
            ],
          };
        case "getResponse":
          return {
            response_id: "response",
            assignment_id: "assignment",
            sample_id: "s_a",
            state: "submitted",
            answers,
            edit_version: 4,
            latest_revision_id: "revision",
            return_reason: null,
            saved_at: "2026-11-06T01:00:00Z",
          };
        case "listRevisions":
          return { items: [{ revision_id: "revision" }], next_cursor: null };
        case "getRevision":
          return {
            revision_id: "revision",
            response_id: "response",
            revision_no: 1,
            edit_version: 4,
            answers,
            config_version_id: "cfg",
            submitted_at: "2026-11-06T01:00:00Z",
          };
        default:
          throw new Error("Unauthorized extra service: " + method);
      }
    });
    const { data, me } = await loadLiveWorkspace(
      service,
      [],
      "/records/response",
    );
    expect(me.role).toBe("participant");
    expect(data.profiles).toEqual([profile]);
    expect(data.responses[0].draft_answers).toEqual(answers);
    expect(data.responses[0].returned_reason).toBeNull();
    expect(data.revisions[0].edit_version).toBe(4);
    expect(data.snapshots).toEqual([]);
    expect(data.audit_events).toEqual([]);
    expect(JSON.stringify(data.experiments)).not.toContain("admin_name");
    expect(service.service.mock.calls.map((c) => c[0])).not.toContain(
      "listParticipants",
    );
  });
  it("refuses another user task or a participant projection containing management names", async () => {
    const foreign = serviceFrom((method) =>
      method === "getMe"
        ? profile
        : {
            items: [{ ...assignment, user_id: "other-person" }],
            next_cursor: null,
          },
    );
    await expect(loadLiveWorkspace(foreign)).rejects.toThrow("非本人");
    const leaking = serviceFrom((method) =>
      method === "getMe"
        ? profile
        : method === "listMyAssignments"
          ? { items: [assignment], next_cursor: null }
          : { ...assignment, config: example, experiment, responses: [] },
    );
    await expect(loadLiveWorkspace(leaking)).rejects.toThrow("非公开样品字段");
  });
  it("uses actual server role for administrators and never infers missing participant roles", async () => {
    const service = serviceFrom((method) =>
      method === "getMe"
        ? { ...profile, role: "admin" }
        : method === "listParticipants"
          ? { items: [{ ...profile, role: undefined }], next_cursor: null }
          : { items: [], next_cursor: null },
    );
    await expect(loadLiveWorkspace(service)).rejects.toThrow("缺少当前角色");
  });
  it("loads a 100-participant by 12-sample admin overview in fewer than 20 RPCs without downloading answers/history", async () => {
    const progress = Array.from({ length: 100 }, (_, p) => ({
      ...assignment,
      assignment_id: `a-${p}`,
      user_id: `p-${p}`,
      responses: Array.from({ length: 12 }, (_, s) => ({
        response_id: `r-${p}-${s}`,
        assignment_id: `a-${p}`,
        sample_id: `s_${s}`,
        state: "submitted",
        edit_version: 2,
        latest_revision_id: `rev-${p}-${s}`,
        latest_revision_no: 1,
        latest_submitted_at: "2026-11-06T01:00:00Z",
        saved_at: "2026-11-06T01:00:00Z",
        return_reason: null,
      })),
    }));
    const service = serviceFrom((method) => {
      switch (method) {
        case "getMe":
          return { ...profile, role: "admin" };
        case "listParticipants":
          return {
            items: Array.from({ length: 100 }, (_, p) => ({
              ...profile,
              user_id: `p-${p}`,
            })),
            next_cursor: null,
          };
        case "listExperiments":
          return { items: [{ experiment_id: "exp" }], next_cursor: null };
        case "getAdminDetail":
          return { ...experiment, config: example };
        case "listProgress":
          return { items: progress, next_cursor: null };
        default:
          throw new Error(
            "Overview must not fetch full answers/history: " + method,
          );
      }
    });
    const { data } = await loadLiveWorkspace(
      service,
      [],
      "/admin/experiments/exp",
    );
    expect(service.service.mock.calls.length).toBeLessThan(20);
    expect(service.service.mock.calls.length).toBe(5);
    expect(data.assignments).toHaveLength(100);
    expect(data.responses).toHaveLength(1200);
    expect(data.revisions).toEqual([]);
    expect(data.responses.every((r) => r.is_summary === true)).toBe(true);
  });
  it("fetches full answers only for the current own sample route and only its latest revision", async () => {
    const other = { ...assignment, assignment_id: "second-assignment" };
    const service = serviceFrom((method, input) => {
      switch (method) {
        case "getMe":
          return profile;
        case "listMyAssignments":
          return { items: [assignment, other], next_cursor: null };
        case "getAssignment":
          return {
            ...(input.assignment_id === assignment.assignment_id
              ? assignment
              : other),
            config: publicConfig,
            experiment,
            responses: [
              {
                response_id: `${input.assignment_id}-response`,
                sample_id: "s_a",
                state: "submitted",
                edit_version: 3,
                latest_revision_id: "latest",
                saved_at: "2026-11-06T01:00:00Z",
                return_reason: null,
              },
            ],
          };
        case "getResponse":
          expect(input).toEqual({
            assignment_id: "assignment",
            sample_id: "s_a",
          });
          return {
            response_id: "assignment-response",
            assignment_id: "assignment",
            sample_id: "s_a",
            state: "submitted",
            edit_version: 3,
            latest_revision_id: "latest",
            answers: { numeric: [], text: [] },
            return_reason: null,
            saved_at: "2026-11-06T01:00:00Z",
          };
        case "getRevision":
          expect(input.revision_id).toBe("latest");
          return {
            revision_id: "latest",
            response_id: "assignment-response",
            revision_no: 1,
            edit_version: 3,
            answers: { numeric: [], text: [] },
            submitted_at: "2026-11-06T01:00:00Z",
            config_version_id: "cfg",
          };
        default:
          throw new Error("Sample form must not fetch full history: " + method);
      }
    });
    const { data } = await loadLiveWorkspace(
      service,
      [],
      "/tasks/assignment/samples/s_a",
    );
    expect(
      service.service.mock.calls.filter((c) => c[0] === "getResponse"),
    ).toHaveLength(1);
    expect(
      service.service.mock.calls.filter((c) => c[0] === "listRevisions"),
    ).toHaveLength(0);
    expect(
      data.responses.find((r) => r.response_id === "assignment-response")
        ?.is_summary,
    ).toBe(false);
    expect(
      data.responses.find((r) => r.response_id === "second-assignment-response")
        ?.is_summary,
    ).toBe(true);
    service.service.mockClear();
    const refreshed = await refreshLiveMutation(
      service,
      data,
      "saveDraft",
      { assignment_id: "assignment" },
      "/tasks/assignment/samples/s_a",
    );
    expect(service.service.mock.calls.map((c) => c[0])).toEqual([
      "getMe",
      "getAssignment",
      "getResponse",
      "getRevision",
    ]);
    expect(refreshed.data.assignments).toHaveLength(2);
  });
  it("fetches frozen rows across all pages and flattens coverage as real data", async () => {
    const frozen = {
      ...experiment,
      snapshot_id: "snapshot",
      config: example,
      input_hash: "frozen-hash",
      mode: "live",
      coverage: [
        {
          participant_code: "P-person",
          assignment_id: "assignment",
          assignment_state: "active",
          profile_state: "active",
          samples: [
            { sample_id: "s_a", state: "submitted", exclusion_reason: null },
            { sample_id: "s_b", state: "draft", exclusion_reason: "draft" },
          ],
        },
      ],
    };
    const service = serviceFrom((_, input) => ({
      ...frozen,
      rows:
        input.cursor === null
          ? { items: [{ revision_id: "revision-1" }], next_cursor: "second" }
          : { items: [{ revision_id: "revision-2" }], next_cursor: null },
    }));
    const snapshot = await loadLiveSnapshot(service, "snapshot");
    expect(snapshot.mode).toBe("live");
    expect(snapshot.is_synthetic).toBe(false);
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.coverage.map((c) => c.included)).toEqual([true, false]);
    expect(snapshot.coverage[1].reason).toBe("draft");
  });
  it("rejects changed frozen page hashes and strips shared editor create placeholders", async () => {
    let n = 0;
    const service = serviceFrom(() => ({
      snapshot_id: "s",
      mode: "live",
      input_hash: String(n++),
      data_revision: 1,
      config_version_id: "cfg",
      rows: { items: [], next_cursor: "next" },
    }));
    await expect(loadLiveSnapshot(service, "s")).rejects.toThrow("分页不一致");
    expect(
      normalizeLiveMutation("createDraft", {
        config: example,
        experiment_id: undefined,
        expected_version: 0,
      }),
    ).toEqual({ config: example });
    expect(
      normalizeLiveMutation("updateDraft", {
        experiment_id: "exp",
        expected_version: 2,
        config: example,
      }),
    ).toHaveProperty("expected_version", 2);
  });
});
