import type {
  AppState,
  Assignment,
  Experiment,
  Profile,
  Response,
  Snapshot,
  Issue,
} from "../../domain/types";
import type { ErrorCode, Result } from "../../services/types";
import {
  normalizeConfig,
  validateAnswers,
  validateConfig,
  validateDraftConfig,
} from "../../domain/validation";
import { canonical, sha256 } from "../../domain/hash";
import { seedState } from "./seed";

interface StoredState extends AppState {
  idempotency: {
    actor_id: string;
    operation: string;
    key: string;
    digest: string;
    result: any;
    assignment_id?: string;
  }[];
}
class BusinessError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public latest_version?: number,
    public field_errors?: Issue[],
  ) {
    super(message);
  }
}
function fail(
  code: ErrorCode,
  message: string,
  version?: number,
  issues?: Issue[],
): never {
  throw new BusinessError(code, message, version, issues);
}
const id = () => crypto.randomUUID();
const newState = (): StoredState => ({ ...seedState(), idempotency: [] });
const version = (entity: { edit_version: number }, expected: unknown) => {
  if (!Number.isInteger(expected) || entity.edit_version !== expected)
    fail(
      "VERSION_CONFLICT",
      "数据已更新，请刷新后再操作。",
      entity.edit_version,
    );
};
const checkIssues = (issues: Issue[]) => {
  if (issues.length)
    fail("VALIDATION_FAILED", "请检查标记的字段。", undefined, issues);
};
const reason = (input: any) => {
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    [...input.reason].length > 2000
  )
    fail("VALIDATION_FAILED", "请填写不超过2000字的操作原因。");
};
function open(e: Experiment) {
  const now = Date.now(),
    info = e.config.experiment;
  if (
    e.status !== "published" ||
    (info.opens_at && now < Date.parse(info.opens_at)) ||
    (info.closes_at && now >= Date.parse(info.closes_at)) ||
    (e.published_at && now >= Date.parse(e.published_at) + 365 * 86400000)
  )
    fail("EXPERIMENT_NOT_OPEN", "当前实验不在采集时间内。");
}

export class DemoAdapter {
  private db?: IDBDatabase;
  constructor(private actorId = "demo-admin") {}
  setActor(actorId: string) {
    this.actorId = actorId;
  }
  async initialize(): Promise<void> {
    if (this.db) return;
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("questionnaire:demo:v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("state");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await this.transaction((s) => s ?? newState());
    } catch {
      throw new Error("演示存储不可用，请允许此网站使用 IndexedDB。");
    }
  }
  private async transaction<T>(
    operation: (state: StoredState) => T,
    write = true,
  ): Promise<T> {
    if (!this.db) throw new Error("演示存储尚未初始化。");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(
          "state",
          write ? "readwrite" : "readonly",
        ),
        store = tx.objectStore("state");
      let result: T;
      let failure: unknown;
      const request = store.get("current");
      request.onsuccess = () => {
        const state: StoredState = request.result ?? newState();
        try {
          result = operation(state);
          if (write) store.put(state, "current");
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error);
    });
  }
  async listIdentities(): Promise<Profile[]> {
    await this.initialize();
    return this.transaction((s) => structuredClone(s.profiles), false);
  }
  async read(): Promise<AppState> {
    await this.initialize();
    return this.transaction((s) => {
      const actor = s.profiles.find((p) => p.user_id === this.actorId);
      if (!actor || actor.state === "disabled")
        throw new Error("当前演示身份不可访问。");
      const { idempotency: _, ...state } = structuredClone(s);
      if (actor.role === "admin") return state;
      state.profiles = state.profiles.filter(
        (p) => p.user_id === actor.user_id,
      );
      state.assignments = state.assignments.filter(
        (a) => a.user_id === actor.user_id,
      );
      const ids = new Set(state.assignments.map((a) => a.assignment_id)),
        experimentIds = new Set(state.assignments.map((a) => a.experiment_id));
      state.experiments = state.experiments.filter((e) =>
        experimentIds.has(e.experiment_id),
      );
      for (const e of state.experiments)
        e.config.samples = e.config.samples.map((sample) => ({
          sample_id: sample.sample_id,
          code: sample.code,
          ...(e.config.experiment.display_sample_names
            ? { display_name: sample.display_name }
            : {}),
        }));
      state.responses = state.responses.filter((r) => ids.has(r.assignment_id));
      const responseIds = new Set(state.responses.map((r) => r.response_id));
      state.revisions = state.revisions.filter((r) =>
        responseIds.has(r.response_id),
      );
      state.snapshots = [];
      state.audit_events = [];
      return state;
    }, false);
  }
  async execute(action: string, input: any = {}): Promise<Result<any>> {
    const request_id = id();
    try {
      await this.initialize();
      const data = await this.transaction((s) =>
        this.apply(s, action, structuredClone(input)),
      );
      return { ok: true, data, request_id };
    } catch (error) {
      const e =
        error instanceof BusinessError
          ? error
          : new BusinessError(
              "STORAGE_UNAVAILABLE",
              "操作未保存，演示存储暂不可用。",
            );
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.code === "STORAGE_UNAVAILABLE",
          ...(e.latest_version !== undefined
            ? { latest_version: e.latest_version }
            : {}),
          ...(e.field_errors ? { field_errors: e.field_errors } : {}),
        },
        request_id,
      };
    }
  }
  private apply(s: StoredState, action: string, input: any): any {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("VALIDATION_FAILED", "操作输入必须是对象。");
    const fields: Record<string, string[]> = {
      createDraft: ["config"],
      updateDraft: ["experiment_id", "config", "expected_version"],
      publish: ["experiment_id", "expected_version"],
      transition: ["experiment_id", "target", "reason", "expected_version"],
      deleteDraft: ["experiment_id", "expected_version"],
      assign: ["experiment_id", "user_ids"],
      setAssignmentState: [
        "assignment_id",
        "state",
        "reason",
        "expected_version",
      ],
      acceptNotice: [
        "assignment_id",
        "config_version_id",
        "privacy_notice_version",
      ],
      saveDraft: [
        "assignment_id",
        "sample_id",
        "config_version_id",
        "answers",
        "expected_version",
      ],
      submit: [
        "assignment_id",
        "sample_id",
        "config_version_id",
        "answers",
        "expected_version",
      ],
      returnResponse: ["response_id", "reason", "expected_version"],
      createSnapshot: ["experiment_id", "expected_data_revision"],
      setProfileState: ["user_id", "state", "reason", "expected_version"],
      createIdentity: ["display_name"],
      reset: [],
      listIdentities: [],
    };
    if (!fields[action]) fail("VALIDATION_FAILED", "未知业务操作。");
    const unknown = Object.keys(input).filter(
      (k) => !fields[action].includes(k) && k !== "idempotency_key",
    );
    if (unknown.length)
      fail(
        "VALIDATION_FAILED",
        "操作含未知字段。",
        undefined,
        unknown.map((k) => ({
          path: "/" + k,
          code: "UNKNOWN_FIELD",
          message: "不允许此字段。",
        })),
      );
    if (action === "reset") {
      Object.assign(s, newState());
      this.actorId = "demo-admin";
      return { reset: true };
    }
    if (action === "listIdentities") return structuredClone(s.profiles);
    if (action === "createIdentity") {
      if (
        typeof input.display_name !== "string" ||
        !input.display_name.trim() ||
        [...input.display_name].length > 100
      )
        fail("VALIDATION_FAILED", "请输入1–100字昵称。");
      const profile: Profile = {
        user_id: id(),
        display_name: input.display_name,
        participant_code: "P" + String(s.profiles.length).padStart(3, "0"),
        role: "participant",
        state: "active",
        edit_version: 1,
      };
      s.profiles.push(profile);
      return profile;
    }
    const actor = s.profiles.find((p) => p.user_id === this.actorId);
    if (!actor) fail("UNAUTHENTICATED", "请选择演示身份。");
    if (actor.state === "disabled") fail("FORBIDDEN", "此账户已停用。");
    if (actor.state !== "active")
      fail("CONSENT_REQUIRED", "请先完成站点告知。");
    const participantActions = ["acceptNotice", "saveDraft", "submit"];
    if (!participantActions.includes(action) && actor.role !== "admin")
      fail("FORBIDDEN", "此操作需要管理员身份。");
    if (
      typeof input.idempotency_key !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.idempotency_key,
      )
    )
      fail("VALIDATION_FAILED", "幂等请求标识必须是 UUID。");
    const digest = sha256(
        canonical({
          ...input,
          ...(input.config ? { config: normalizeConfig(input.config) } : {}),
        }),
      ),
      prior = s.idempotency.find(
        (r) =>
          r.actor_id === actor.user_id &&
          r.operation === action &&
          r.key === input.idempotency_key,
      );
    if (prior) {
      if (prior.digest !== digest)
        fail("IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同内容。");
      if (prior.assignment_id) {
        const assignment = s.assignments.find(
          (a) => a.assignment_id === prior.assignment_id,
        );
        if (
          !assignment ||
          assignment.user_id !== actor.user_id ||
          assignment.state !== "active"
        )
          fail("FORBIDDEN", "当前身份已无权读取该操作结果。");
      }
      return structuredClone(prior.result);
    }
    const now = new Date().toISOString();
    let result: any;
    let object_id = "";
    const experiment = (eid: string) => {
      const e = s.experiments.find((e) => e.experiment_id === eid);
      if (!e) fail("NOT_FOUND", "实验不存在。");
      return e;
    };
    const assignment = (aid: string, own = false) => {
      const a = s.assignments.find((a) => a.assignment_id === aid);
      if (!a) fail(own ? "FORBIDDEN" : "NOT_FOUND", "任务不可访问。");
      if (own && a.user_id !== actor.user_id)
        fail("FORBIDDEN", "任务不可访问。");
      return a;
    };
    switch (action) {
      case "createDraft": {
        checkIssues(validateDraftConfig(input.config));
        const e: Experiment = {
          experiment_id: id(),
          status: "draft",
          config: normalizeConfig(input.config),
          config_version_id: null,
          edit_version: 1,
          data_revision: 0,
          published_at: null,
          closed_at: null,
          created_at: now,
        };
        s.experiments.push(e);
        result = { ...e, publish_issues: validateConfig(e.config) };
        object_id = e.experiment_id;
        break;
      }
      case "updateDraft": {
        const e = experiment(input.experiment_id);
        version(e, input.expected_version);
        if (e.status !== "draft") fail("FORBIDDEN", "发布后的配置已经冻结。");
        checkIssues(validateDraftConfig(input.config));
        e.config = normalizeConfig(input.config);
        e.edit_version++;
        result = { ...e, publish_issues: validateConfig(e.config) };
        object_id = e.experiment_id;
        break;
      }
      case "publish": {
        const e = experiment(input.experiment_id);
        version(e, input.expected_version);
        if (e.status !== "draft") fail("FORBIDDEN", "只能发布草稿。");
        checkIssues(validateConfig(e.config));
        if (
          e.config.experiment.closes_at &&
          Date.parse(e.config.experiment.closes_at) <= Date.now()
        )
          fail("EXPERIMENT_NOT_OPEN", "已截止的实验不能发布。");
        e.config = normalizeConfig(e.config);
        e.status = "published";
        e.config_version_id = id();
        e.published_at = now;
        e.privacy_notice_version = "demo-notice-v1";
        e.edit_version++;
        result = e;
        object_id = e.experiment_id;
        break;
      }
      case "transition": {
        const e = experiment(input.experiment_id);
        version(e, input.expected_version);
        reason(input);
        if (
          !(
            (e.status === "published" && input.target === "closed") ||
            (e.status === "closed" && input.target === "archived")
          )
        )
          fail("VALIDATION_FAILED", "不允许此实验状态转换。");
        e.status = input.target;
        e.edit_version++;
        if (input.target === "closed") e.closed_at = now;
        result = e;
        object_id = e.experiment_id;
        break;
      }
      case "deleteDraft": {
        const e = experiment(input.experiment_id);
        version(e, input.expected_version);
        if (
          e.status !== "draft" ||
          s.assignments.some((a) => a.experiment_id === e.experiment_id)
        )
          fail("FORBIDDEN", "只能删除没有关联数据的草稿。");
        s.experiments = s.experiments.filter((x) => x !== e);
        result = { experiment_id: e.experiment_id, deleted: true };
        object_id = e.experiment_id;
        break;
      }
      case "assign": {
        const e = experiment(input.experiment_id);
        if (e.status !== "published")
          fail("EXPERIMENT_NOT_OPEN", "只能向已发布实验分配任务。");
        if (
          !Array.isArray(input.user_ids) ||
          input.user_ids.length < 1 ||
          input.user_ids.length > 100 ||
          new Set(input.user_ids).size !== input.user_ids.length
        )
          fail("VALIDATION_FAILED", "请选择1–100位不重复的评价员。");
        const existing: Assignment[] = [],
          added: Assignment[] = [];
        for (const uid of input.user_ids) {
          const p = s.profiles.find((p) => p.user_id === uid);
          if (!p || p.state !== "active")
            fail("VALIDATION_FAILED", "所选评价员未激活或已停用。");
          const a = s.assignments.find(
            (a) => a.experiment_id === e.experiment_id && a.user_id === uid,
          );
          if (a) {
            if (a.state === "revoked")
              fail("VALIDATION_FAILED", "已撤销任务需显式恢复。");
            existing.push(a);
          } else
            added.push({
              assignment_id: id(),
              experiment_id: e.experiment_id,
              user_id: uid,
              state: "active",
              edit_version: 1,
              consented_at: null,
              config_version_id: e.config_version_id!,
              privacy_notice_version: e.privacy_notice_version!,
              created_at: now,
            });
        }
        if (
          s.assignments.filter((a) => a.experiment_id === e.experiment_id)
            .length +
            added.length >
          100
        )
          fail("VALIDATION_FAILED", "实验最多100名评价员。");
        s.assignments.push(...added);
        if (added.length) e.data_revision++;
        result = {
          assignments: [...existing, ...added],
          existing: existing.map((a) => a.assignment_id),
        };
        object_id = e.experiment_id;
        break;
      }
      case "setAssignmentState": {
        const a = assignment(input.assignment_id),
          e = experiment(a.experiment_id);
        version(a, input.expected_version);
        reason(input);
        if (!["active", "revoked"].includes(input.state))
          fail("VALIDATION_FAILED", "任务状态不合法。");
        if (e.status === "archived")
          fail("FORBIDDEN", "归档实验不能更改任务。");
        if (input.state === "active") open(e);
        if (a.state !== input.state) {
          a.state = input.state;
          a.edit_version++;
          e.data_revision++;
        }
        result = a;
        object_id = a.assignment_id;
        break;
      }
      case "acceptNotice": {
        const a = assignment(input.assignment_id, true),
          e = experiment(a.experiment_id);
        if (a.state !== "active") fail("ASSIGNMENT_REVOKED", "任务已撤销。");
        if (
          input.config_version_id !== e.config_version_id ||
          input.privacy_notice_version !== a.privacy_notice_version
        )
          fail("VALIDATION_FAILED", "告知版本不匹配。");
        if (!a.consented_at) a.consented_at = now;
        result = {
          assignment_id: a.assignment_id,
          consented_at: a.consented_at,
        };
        object_id = a.assignment_id;
        break;
      }
      case "saveDraft":
      case "submit": {
        const a = assignment(input.assignment_id, true),
          e = experiment(a.experiment_id);
        if (a.state !== "active") fail("ASSIGNMENT_REVOKED", "任务已撤销。");
        if (!a.consented_at)
          fail("CONSENT_REQUIRED", "请先阅读并接受本实验告知。");
        open(e);
        if (
          input.config_version_id !== e.config_version_id ||
          !e.config.samples.some(
            (sample) => sample.sample_id === input.sample_id,
          )
        )
          fail("VALIDATION_FAILED", "配置版本或样品引用无效。");
        let response = s.responses.find(
          (r) =>
            r.assignment_id === a.assignment_id &&
            r.sample_id === input.sample_id,
        );
        if (response) version(response, input.expected_version);
        else if (input.expected_version !== 0)
          fail("VERSION_CONFLICT", "答卷尚未建立。", 0);
        if (response?.state === "submitted")
          fail("RESPONSE_LOCKED", "已提交答卷需要管理员退回后才可修改。");
        checkIssues(
          validateAnswers(e.config, input.answers, action === "submit"),
        );
        if (!response) {
          response = {
            response_id: id(),
            assignment_id: a.assignment_id,
            sample_id: input.sample_id,
            state: "draft",
            draft_answers: input.answers,
            edit_version: 0,
            latest_revision_id: null,
            returned_reason: null,
            saved_at: now,
          };
          s.responses.push(response);
          if (action === "saveDraft") e.data_revision++;
        }
        response.draft_answers = structuredClone(input.answers);
        response.edit_version++;
        response.saved_at = now;
        object_id = response.response_id;
        if (action === "submit") {
          const revision = {
            response_id: response.response_id,
            revision_id: id(),
            revision_no:
              s.revisions.filter((r) => r.response_id === response.response_id)
                .length + 1,
            submitted_at: now,
            edit_version: response.edit_version,
            answers: structuredClone(input.answers),
            config_version_id: e.config_version_id!,
            submitted_by: actor.user_id,
            idempotency_key: input.idempotency_key,
          };
          s.revisions.push(revision);
          response.latest_revision_id = revision.revision_id;
          response.state = "submitted";
          response.returned_reason = null;
          e.data_revision++;
          const {
            answers: _,
            config_version_id: __,
            submitted_by: ___,
            idempotency_key: ____,
            ...receipt
          } = revision;
          result = receipt;
        } else result = response;
        break;
      }
      case "returnResponse": {
        const r = s.responses.find((r) => r.response_id === input.response_id);
        if (!r) fail("NOT_FOUND", "答卷不存在。");
        const a = assignment(r.assignment_id),
          e = experiment(a.experiment_id);
        version(r, input.expected_version);
        reason(input);
        open(e);
        if (
          a.state !== "active" ||
          s.profiles.find((p) => p.user_id === a.user_id)?.state !== "active"
        )
          fail("FORBIDDEN", "此任务或账户不可写入。");
        if (r.state !== "submitted")
          fail("VALIDATION_FAILED", "只能退回已提交答卷。");
        const revision = s.revisions.find(
          (x) => x.revision_id === r.latest_revision_id,
        )!;
        r.draft_answers = structuredClone(revision.answers);
        r.state = "returned";
        r.returned_reason = input.reason;
        r.edit_version++;
        r.saved_at = now;
        e.data_revision++;
        result = { ...r, returned_at: now };
        object_id = r.response_id;
        break;
      }
      case "setProfileState": {
        const p = s.profiles.find((p) => p.user_id === input.user_id);
        if (!p) fail("NOT_FOUND", "账户不存在。");
        version(p, input.expected_version);
        reason(input);
        if (
          !["active", "disabled"].includes(input.state) ||
          p.state === "pending_consent"
        )
          fail("VALIDATION_FAILED", "不能以此操作激活未建档账户。");
        if (
          p.role === "admin" &&
          input.state === "disabled" &&
          s.profiles.filter((p) => p.role === "admin" && p.state === "active")
            .length <= 1
        )
          fail("FORBIDDEN", "不能停用最后一位有效管理员。");
        if (p.state !== input.state) {
          p.state = input.state;
          p.edit_version++;
          const affected = new Set(
            s.assignments
              .filter((a) => a.user_id === p.user_id)
              .map((a) => a.experiment_id),
          );
          for (const e of s.experiments)
            if (affected.has(e.experiment_id)) e.data_revision++;
        }
        result = p;
        object_id = p.user_id;
        break;
      }
      case "createSnapshot": {
        const e = experiment(input.experiment_id);
        if (e.status === "draft")
          fail("VALIDATION_FAILED", "草稿实验没有冻结配置。");
        if (input.expected_data_revision !== e.data_revision)
          fail("DATA_CHANGED", "实验数据已变化，请刷新后生成快照。");
        const snapshot: Snapshot = {
          snapshot_id: id(),
          experiment_id: e.experiment_id,
          config_version_id: e.config_version_id!,
          config: structuredClone(e.config),
          data_revision: e.data_revision,
          created_at: now,
          input_hash: "",
          rows: [],
          coverage: [],
          mode: "demo",
          is_synthetic: true,
        };
        for (const a of s.assignments.filter(
          (a) => a.experiment_id === e.experiment_id,
        )) {
          const p = s.profiles.find((p) => p.user_id === a.user_id)!;
          for (const sample of e.config.samples) {
            const r = s.responses.find(
                (r) =>
                  r.assignment_id === a.assignment_id &&
                  r.sample_id === sample.sample_id,
              ),
              revision = s.revisions.find(
                (x) => x.revision_id === r?.latest_revision_id,
              );
            const exclusion =
              p.state !== "active"
                ? "ACCOUNT_DISABLED"
                : a.state !== "active"
                  ? "ASSIGNMENT_REVOKED"
                  : !r
                    ? "NOT_STARTED"
                    : r.state !== "submitted"
                      ? r.state.toUpperCase()
                      : revision?.config_version_id !== e.config_version_id
                        ? "CONFIG_MISMATCH"
                        : "";
            snapshot.coverage.push({
              participant_code: p.participant_code,
              assignment_id: a.assignment_id,
              assignment_state: a.state,
              sample_id: sample.sample_id,
              response_state: r?.state ?? "not_started",
              included: !exclusion,
              reason: exclusion || "INCLUDED",
            });
            if (!exclusion && r && revision)
              snapshot.rows.push({
                participant_code: p.participant_code,
                sample_id: r.sample_id,
                response_id: r.response_id,
                revision_id: revision.revision_id,
                revision_no: revision.revision_no,
                submitted_at: revision.submitted_at,
                answers: structuredClone(revision.answers),
              });
          }
        }
        const responseIds = new Set(
          s.responses
            .filter((r) =>
              s.assignments.some(
                (a) =>
                  a.assignment_id === r.assignment_id &&
                  a.experiment_id === e.experiment_id,
              ),
            )
            .map((r) => r.response_id),
        );
        const included = new Set(snapshot.rows.map((r) => r.revision_id));
        snapshot.excluded_revisions = s.revisions
          .filter(
            (r) =>
              responseIds.has(r.response_id) && !included.has(r.revision_id),
          )
          .map((r) => {
            const response = s.responses.find(
              (x) => x.response_id === r.response_id,
            )!;
            const a = s.assignments.find(
              (x) => x.assignment_id === response.assignment_id,
            )!;
            const p = s.profiles.find((x) => x.user_id === a.user_id)!;
            return {
              response_id: r.response_id,
              revision_id: r.revision_id,
              reason:
                response.latest_revision_id !== r.revision_id
                  ? "OLD_REVISION"
                  : p.state !== "active"
                    ? "ACCOUNT_DISABLED"
                    : a.state !== "active"
                      ? "ASSIGNMENT_REVOKED"
                      : response.state.toUpperCase(),
            };
          })
          .sort((a, b) => a.revision_id.localeCompare(b.revision_id));
        snapshot.rows.sort(
          (a, b) =>
            a.participant_code.localeCompare(b.participant_code) ||
            a.sample_id.localeCompare(b.sample_id),
        );
        snapshot.coverage.sort(
          (a, b) =>
            a.participant_code.localeCompare(b.participant_code) ||
            a.sample_id.localeCompare(b.sample_id),
        );
        snapshot.input_hash = sha256(
          canonical({
            config: snapshot.config,
            rows: snapshot.rows,
            coverage: snapshot.coverage,
            excluded_revisions: snapshot.excluded_revisions,
            method_version: "descriptive-v1",
          }),
        );
        s.snapshots.push(snapshot);
        result = snapshot;
        object_id = snapshot.snapshot_id;
        break;
      }
      default:
        fail("VALIDATION_FAILED", "未知业务操作。");
    }
    const copied = structuredClone(result);
    s.idempotency.push({
      actor_id: actor.user_id,
      operation: action,
      key: input.idempotency_key,
      digest,
      result: copied,
      ...(participantActions.includes(action)
        ? { assignment_id: input.assignment_id }
        : {}),
    });
    s.audit_events.push({
      event_id: id(),
      actor_id: actor.user_id,
      action,
      object_id,
      created_at: now,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return structuredClone(copied);
  }
}
