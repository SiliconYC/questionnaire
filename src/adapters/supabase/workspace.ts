import type {
  AppState,
  Assignment,
  Experiment,
  Profile,
  Response,
  Revision,
  Snapshot,
  SnapshotRow,
  Coverage,
} from "../../domain/types";
import type { Result, rpcMethods } from "./index";

export interface LiveService {
  service<T = unknown>(
    method: keyof typeof rpcMethods,
    input?: Record<string, unknown>,
  ): Promise<Result<T>>;
}
export interface LiveMe extends Profile {
  site_ready: boolean;
  site_notice_version: string;
  site_notice: Record<string, unknown>;
}
interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
interface ResponseSummary
  extends Omit<Response, "draft_answers" | "returned_reason"> {
  return_reason: string | null;
  latest_revision_no?: number;
  latest_submitted_at?: string | null;
}
interface AssignmentProgress extends Assignment {
  responses: ResponseSummary[];
}
interface AssignmentDetail extends AssignmentProgress {
  config: Experiment["config"];
  experiment: Omit<Experiment, "config">;
}
interface ResponseDto
  extends Omit<Response, "draft_answers" | "returned_reason"> {
  answers: Response["draft_answers"];
  return_reason: string | null;
}
interface SnapshotDto
  extends Omit<Snapshot, "rows" | "coverage" | "is_synthetic"> {
  rows: Page<SnapshotRow>;
  coverage: {
    participant_code: string;
    assignment_id: string;
    assignment_state: string;
    profile_state: string;
    samples: {
      sample_id: string;
      state: string;
      exclusion_reason: string | null;
    }[];
  }[];
}
export class LiveRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly request_id: string;
  constructor(result: Extract<Result<unknown>, { ok: false }>) {
    super(
      `${result.error.message}${result.error.field_errors?.length ? "\n" + result.error.field_errors.map((f) => `${f.path}：${f.message}`).join("\n") : ""}（请求号 ${result.request_id}）`,
    );
    this.code = result.error.code;
    this.retryable = result.error.retryable;
    this.request_id = result.request_id;
    Object.assign(this, { latest_version: result.error.latest_version });
  }
}
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new LiveRequestError(result);
  return result.data;
}
export function normalizeLiveMutation(
  action: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (action === "createDraft") {
    delete normalized.experiment_id;
    delete normalized.expected_version;
  }
  return normalized;
}
export async function allPages<T>(
  service: LiveService,
  method: keyof typeof rpcMethods,
  input: Record<string, unknown> = {},
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<T> = unwrap(
      await service.service<Page<T>>(method, { ...input, limit: 100, cursor }),
    );
    if (
      !Array.isArray(page.items) ||
      !(page.next_cursor === null || typeof page.next_cursor === "string")
    )
      throw new Error("真实服务分页响应无效。");
    items.push(...page.items);
    cursor = page.next_cursor;
    if (cursor) {
      if (seen.has(cursor))
        throw new Error("真实服务返回重复游标，已停止读取。");
      seen.add(cursor);
    }
  } while (cursor);
  return items;
}
export const emptyWorkspace = (): AppState => ({
  profiles: [],
  experiments: [],
  assignments: [],
  responses: [],
  revisions: [],
  snapshots: [],
  audit_events: [],
});

function assignmentDto(detail: AssignmentProgress): Assignment {
  return {
    assignment_id: detail.assignment_id,
    experiment_id: detail.experiment_id,
    user_id: detail.user_id,
    state: detail.state,
    edit_version: detail.edit_version,
    consented_at: detail.consented_at,
    config_version_id: detail.config_version_id,
    privacy_notice_version: detail.privacy_notice_version,
    created_at: detail.created_at,
    privacy_notice: detail.privacy_notice,
    retention_policy: detail.retention_policy,
    collection_ends_at: detail.collection_ends_at,
  };
}
function summaryDto(summary: ResponseSummary, assignment_id: string): Response {
  const { return_reason, ...metadata } = summary;
  return {
    ...metadata,
    assignment_id,
    draft_answers: { numeric: [], text: [] },
    returned_reason: return_reason,
    is_summary: true,
  };
}

export async function loadLiveWorkspace(
  service: LiveService,
  snapshots: Snapshot[] = [],
  pathname = "/",
): Promise<{ data: AppState; me: LiveMe }> {
  const me = unwrap(await service.service<LiveMe>("getMe"));
  if (me.state !== "active") throw new Error("请先完成真实账户建档。");
  if (me.role !== "admin" && me.role !== "participant")
    throw new Error("服务端未返回可用角色。");
  const data = emptyWorkspace();
  data.profiles = [me];
  const assignments: AssignmentProgress[] = [];
  if (me.role === "admin") {
    const profiles = await allPages<Profile>(service, "listParticipants");
    if (profiles.some((p) => p.role !== "admin" && p.role !== "participant"))
      throw new Error("服务端评价员列表缺少当前角色，请升级数据库迁移。");
    data.profiles = profiles.filter((p) => p.user_id !== me.user_id).concat(me);
    const experiments = await allPages<{ experiment_id: string }>(
      service,
      "listExperiments",
    );
    for (const item of experiments) {
      const experiment = unwrap(
        await service.service<Experiment>("getAdminDetail", {
          experiment_id: item.experiment_id,
        }),
      );
      data.experiments.push(experiment);
      const progress = await allPages<AssignmentProgress>(
        service,
        "listProgress",
        { experiment_id: item.experiment_id },
      );
      assignments.push(...progress);
    }
    for (const snapshot of snapshots.filter((s) =>
      data.experiments.some((e) => e.experiment_id === s.experiment_id),
    )) {
      const result = await service.service<{
        snapshot_id: string;
        input_hash: string;
        config_version_id: string;
      }>("getSnapshot", {
        snapshot_id: snapshot.snapshot_id,
        limit: 1,
        cursor: null,
      });
      if (!result.ok && result.error.code === "NOT_FOUND") continue;
      const current = unwrap(result);
      if (
        current.snapshot_id === snapshot.snapshot_id &&
        current.input_hash === snapshot.input_hash &&
        current.config_version_id === snapshot.config_version_id
      )
        data.snapshots.push(snapshot);
    }
  } else {
    const mine = await allPages<Assignment>(service, "listMyAssignments");
    for (const item of mine) {
      if (item.user_id !== me.user_id)
        throw new Error("服务端返回非本人任务，已停止读取。");
      const detail = unwrap(
        await service.service<AssignmentDetail>("getAssignment", {
          assignment_id: item.assignment_id,
        }),
      );
      if (detail.user_id !== me.user_id)
        throw new Error("服务端任务归属不匹配。");
      if (
        detail.config.samples.some(
          (s) =>
            s.admin_name !== undefined ||
            (!detail.config.experiment.display_sample_names &&
              s.display_name !== undefined),
        )
      )
        throw new Error("参与者配置返回了非公开样品字段，已停止读取。");
      assignments.push(detail);
      if (
        !data.experiments.some((e) => e.experiment_id === detail.experiment_id)
      )
        data.experiments.push({ ...detail.experiment, config: detail.config });
    }
  }
  for (const detail of assignments) {
    const responseSummaries = detail.responses;
    const assignment = assignmentDto(detail);
    data.assignments.push(assignment);
    for (const summary of responseSummaries) {
      data.responses.push(summaryDto(summary, assignment.assignment_id));
    }
  }
  await hydrateCurrentResponse(service, data, me, pathname);
  return { data, me };
}

async function hydrateCurrentResponse(
  service: LiveService,
  data: AppState,
  me: LiveMe,
  pathname: string,
): Promise<void> {
  const sampleRoute = /^\/tasks\/([^/]+)\/samples\/([^/]+)\/?$/.exec(pathname);
  const recordRoute = /^\/records\/([^/]+)\/?$/.exec(pathname);
  let target: { assignment_id: string; sample_id: string } | undefined;
  if (sampleRoute) {
    const assignment = data.assignments.find(
      (a) =>
        a.assignment_id === decodeURIComponent(sampleRoute[1]) &&
        a.user_id === me.user_id,
    );
    const experiment = data.experiments.find(
      (e) => e.experiment_id === assignment?.experiment_id,
    );
    const sample_id = decodeURIComponent(sampleRoute[2]);
    if (
      assignment &&
      experiment?.config.samples.some((s) => s.sample_id === sample_id)
    )
      target = { assignment_id: assignment.assignment_id, sample_id };
  } else if (recordRoute) {
    const response = data.responses.find(
      (r) => r.response_id === decodeURIComponent(recordRoute[1]),
    );
    if (response)
      target = {
        assignment_id: response.assignment_id,
        sample_id: response.sample_id,
      };
  }
  if (target) {
    const dto = unwrap(
      await service.service<ResponseDto | null>("getResponse", target),
    );
    data.responses = data.responses.filter(
      (r) =>
        !(
          r.assignment_id === target!.assignment_id &&
          r.sample_id === target!.sample_id
        ),
    );
    if (dto) {
      if (
        dto.assignment_id !== target.assignment_id ||
        dto.sample_id !== target.sample_id
      )
        throw new Error("服务端答卷归属不匹配。");
      const { answers, return_reason, ...rest } = dto;
      const response: Response = {
        ...rest,
        draft_answers: answers,
        returned_reason: return_reason,
        is_summary: false,
      };
      data.responses.push(response);
      if (recordRoute) {
        const revisions = await allPages<{ revision_id: string }>(
          service,
          "listRevisions",
          { response_id: response.response_id },
        );
        for (const revision of revisions)
          data.revisions.push(
            unwrap(
              await service.service<Revision>("getRevision", {
                revision_id: revision.revision_id,
              }),
            ),
          );
      } else if (response.latest_revision_id)
        data.revisions.push(
          unwrap(
            await service.service<Revision>("getRevision", {
              revision_id: response.latest_revision_id,
            }),
          ),
        );
    }
  }
}

export async function refreshLiveMutation(
  service: LiveService,
  current: AppState,
  action: string,
  input: Record<string, unknown>,
  pathname: string,
): Promise<{ data: AppState; me: LiveMe }> {
  if (
    ![
      "saveDraft",
      "submit",
      "acceptNotice",
      "returnResponse",
      "returnForCorrection",
      "setAssignmentState",
    ].includes(action)
  )
    return loadLiveWorkspace(service, current.snapshots, pathname);
  const assignment_id =
    typeof input.assignment_id === "string"
      ? input.assignment_id
      : current.responses.find((r) => r.response_id === input.response_id)
          ?.assignment_id;
  if (
    !assignment_id ||
    !current.assignments.some((a) => a.assignment_id === assignment_id)
  )
    return loadLiveWorkspace(service, current.snapshots, pathname);
  const me = unwrap(await service.service<LiveMe>("getMe"));
  const previousMe = current.profiles.find((p) => p.user_id === me.user_id);
  if (me.state !== "active" || me.role !== previousMe?.role)
    return loadLiveWorkspace(service, [], pathname);
  const detail = unwrap(
    await service.service<AssignmentDetail>("getAssignment", { assignment_id }),
  );
  if (
    detail.assignment_id !== assignment_id ||
    (me.role !== "admin" && detail.user_id !== me.user_id)
  )
    throw new Error("服务端任务归属不匹配。");
  const previousExperiment = current.experiments.find(
    (e) => e.experiment_id === detail.experiment_id,
  );
  if (
    !previousExperiment ||
    previousExperiment.config_version_id !== detail.config_version_id
  )
    return loadLiveWorkspace(service, current.snapshots, pathname);
  if (
    me.role !== "admin" &&
    detail.config.samples.some(
      (s) =>
        s.admin_name !== undefined ||
        (!detail.config.experiment.display_sample_names &&
          s.display_name !== undefined),
    )
  )
    throw new Error("参与者配置返回了非公开样品字段，已停止读取。");
  const data: AppState = {
    ...current,
    profiles: current.profiles.map((p) => (p.user_id === me.user_id ? me : p)),
    experiments: current.experiments.map((e) =>
      e.experiment_id === detail.experiment_id
        ? {
            ...e,
            ...detail.experiment,
            config: me.role === "admin" ? e.config : detail.config,
          }
        : e,
    ),
    assignments: current.assignments.map((a) =>
      a.assignment_id === assignment_id ? assignmentDto(detail) : a,
    ),
    responses: [
      ...current.responses.filter((r) => r.assignment_id !== assignment_id),
      ...detail.responses.map((r) => summaryDto(r, assignment_id)),
    ],
    revisions: [],
  };
  await hydrateCurrentResponse(service, data, me, pathname);
  return { data, me };
}

export async function loadLiveSnapshot(
  service: LiveService,
  snapshot_id: string,
): Promise<Snapshot> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  const rows: SnapshotRow[] = [];
  let frozen: SnapshotDto | undefined;
  do {
    const page: SnapshotDto = unwrap(
      await service.service<SnapshotDto>("getSnapshot", {
        snapshot_id,
        cursor,
        limit: 100,
      }),
    );
    if (page.mode !== "live" || page.snapshot_id !== snapshot_id)
      throw new Error("快照来源或模式不匹配。");
    if (
      frozen &&
      (frozen.input_hash !== page.input_hash ||
        frozen.data_revision !== page.data_revision ||
        frozen.config_version_id !== page.config_version_id)
    )
      throw new Error("冻结快照分页不一致，已停止读取。");
    if (
      !Array.isArray(page.rows?.items) ||
      !(
        page.rows.next_cursor === null ||
        typeof page.rows.next_cursor === "string"
      )
    )
      throw new Error("真实快照分页响应无效。");
    frozen ??= page;
    rows.push(...page.rows.items);
    cursor = page.rows.next_cursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error("真实快照返回重复游标。");
      seen.add(cursor);
    }
  } while (cursor);
  if (!frozen) throw new Error("无法读取真实快照。");
  const coverage: Coverage[] = frozen.coverage.flatMap((a) =>
    a.samples.map((s) => ({
      participant_code: a.participant_code,
      assignment_id: a.assignment_id,
      assignment_state: a.assignment_state,
      sample_id: s.sample_id,
      response_state: s.state,
      included: s.exclusion_reason === null,
      reason: s.exclusion_reason ?? "included",
    })),
  );
  return { ...frozen, mode: "live", is_synthetic: false, rows, coverage };
}
