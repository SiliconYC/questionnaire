# 05 · 服务接口与错误契约

## 1. 使用方式

本章定义前端依赖的领域接口。M1 和 M2 必须对同一套行为契约负责；`DemoAdapter` 用 IndexedDB 实现，`SupabaseAdapter` 调用认证 SDK 和受控数据库 RPC。接口名是本次设计要求，尚不是仓库里已经存在的代码。

业务写入经事务 RPC，所有 RPC 的输入统一封装为 `p_input` JSON 对象，业务响应统一为下列 `Result<T>`。SQL 实现需逐字段验证 JSON 类型、未知键和约束，不能因采用 JSON 省略校验。只读 RPC 使用相同输入封装。

```ts
type Result<T> =
  | { ok: true; data: T; request_id: string }
  | { ok: false; error: {
      code: ErrorCode;
      message: string;
      field_errors?: { path: string; code: string; message: string }[];
      latest_version?: number;
      retryable: boolean;
    }; request_id: string };

type Page<T> = { items: T[]; next_cursor: string | null };
type MutationKey = { idempotency_key: string };
type VersionedMutation = MutationKey & { expected_version: number };
```

本文中的 `Profile`、`Experiment`、`Assignment`、`Response`、`SubmissionReceipt`、`Answers` 和 `AnalysisSnapshot` 对应 [04](04-data-model.md) 的实体/对象；`ExperimentConfig` 对应 [06](06-configuration-format.md) 和 JSON Schema，`DraftExperimentConfig` 对应其编辑草稿规则。前端必须生成或维护一致的 TypeScript 类型，不在各页面重新定义同名不同结构对象。

只读返回均为白名单 DTO，不返回数据库整行。列表按稳定的 `created_at + id` 排序并以不透明游标分页，默认 `50` 项、最大 `100` 项；前端需要完整列表时应持续翻页，不能把第一页当全部数据。

## 2. 认证与账户服务

| 领域方法 | 输入 | 输出/行为 | 真实实现 |
| --- | --- | --- | --- |
| `AuthService.getSession()` | 无 | 已验证会话摘要或 `null`，不向组件扩散刷新令牌 | 官方 SDK |
| `AuthService.sendOtp(input)` | `email`、`intent=register/login` | 通用“如可用将发送验证码”结果，不泄露账户是否存在 | `signInWithOtp`；注册可建用户、登录不可自动建用户 |
| `AuthService.verifyOtp(input)` | `email`、`token` | 经提供方验证的会话，随后读取资料 | `verifyOtp`，类型 `email` |
| `AuthService.signOut()` | 无 | 清理当前会话和用户内存数据 | 官方 SDK；远端失败仍清理本地并说明结果 |
| `ProfileService.getMe()` | 无 | 本人资料、当前角色、建档状态 | `api_get_me` |
| `ProfileService.completeOnboarding(input)` | `display_name`、`consent_version`、幂等键 | 激活的本人资料与服务端生成的 `participant_code` | `api_complete_onboarding` |
| `ProfileService.listParticipants(input)` | `state`、`cursor`、`limit` | `Page<ProfileSummary>`，只含代号、昵称、状态 | `api_list_participants`，管理员 |
| `ProfileService.setState(input)` | `user_id`、`state=active/disabled`、`reason`、版本和幂等键 | 更新后资料；不得由此激活未完成建档者 | `api_set_profile_state`，管理员 |
| `PrivacyService.requestDeletion(input)` | `reason`、幂等键 | `request_id`、`status=pending` | `api_request_deletion`，本人 |

`demo` 的真实 OTP 能力为关闭状态。演示工具单独提供 `DemoControl.createIdentity`、`switchIdentity`、`reset`，不通过 `verifyOtp` 冒充真实验证。真实模式不得装配 `DemoControl`。

首次管理员授予通过受信管理环境完成；不提供公开可调用的“成为管理员”接口。停用校验必须查询当前受保护账户状态，不能等待缓存 JWT 角色过期才生效。最后一位有效管理员不得通过页面被停用，受控撤站流程除外。

## 3. 实验服务

| 领域方法 | 输入 | 返回与原子行为 | RPC |
| --- | --- | --- | --- |
| `ExperimentService.createDraft` | `config: DraftExperimentConfig`、幂等键 | 创建 `draft` 实验，返回 `experiment_id, edit_version=1, publish_issues` | `api_create_experiment` |
| `ExperimentService.updateDraft` | `experiment_id, config: DraftExperimentConfig`、版本和幂等键 | 通过草稿结构检查后整体替换，返回新版本和 `publish_issues`；未完成不阻止存草稿 | `api_update_experiment_draft` |
| `ExperimentService.listMine` | 过滤条件、游标、数量 | 管理员见全站列表；评价员仅获分配实验摘要 | `api_list_experiments` |
| `ExperimentService.getAdminDetail` | `experiment_id` | 完整配置、状态、版本、进度摘要 | `api_get_experiment_admin` |
| `ExperimentService.publish` | `experiment_id`、版本和幂等键 | 校验、固化配置与站点隐私策略、转 `published`；返回配置版本 | `api_publish_experiment` |
| `ExperimentService.transition` | `experiment_id, target=closed/archived, reason`、版本和幂等键 | 只允许状态机合法方向；与提交互斥 | `api_transition_experiment` |
| `ExperimentService.deleteDraft` | `experiment_id`、版本和幂等键 | 仅删除未发布且没有业务关联的草稿 | `api_delete_experiment_draft` |

管理员复制实验时读取已有配置，再调用 `createDraft`，产生新 ID，去除旧日程并由用户核对；不能复制答卷、分配、同意记录或统计结果。配置导入也只能创建新草稿或显式更新选中的草稿。

## 4. 分配与参与者配置

| 领域方法 | 输入 | 返回与规则 | RPC |
| --- | --- | --- | --- |
| `AssignmentService.assign` | `experiment_id, user_ids[]`、幂等键 | 批量原子分配；已有 active 返回 existing；已 revoked 返回需显式恢复，不自动恢复 | `api_assign_participants` |
| `AssignmentService.setState` | `assignment_id, state, reason`、版本和幂等键 | 返回同一任务新状态；恢复保留原记录并检查实验开放 | `api_set_assignment_state` |
| `AssignmentService.listMine` | 过滤条件、游标、数量 | 本人任务列表含各样品当前状态与进度 | `api_list_my_assignments` |
| `AssignmentService.getDetail` | `assignment_id` | 本人任务、参与者配置投影、告知、同意状态、可用动作 | `api_get_assignment` |
| `AssignmentService.acceptNotice` | `assignment_id, config_version_id, privacy_notice_version`、幂等键 | 记录本人同意，返回 `consented_at`；不得替别人接受 | `api_accept_assignment_notice` |
| `AssignmentService.listProgress` | `experiment_id`、游标、数量 | 管理员进度表；过滤条件在服务端执行 | `api_list_experiment_progress` |

一次分配最多 `100` 个不同用户。输入重复 ID 先报告错误，不默默去重；存在未建档/停用用户或将超过人数上限时整批失败，返回具体条目。事务锁定实验以防并发批次各自通过人数上限。仅已发布实验允许分配，真实身份 ID 必须存在。

新建任务改变覆盖分母，须在同一事务更新实验 `data_revision`；全部返回 existing 的批次不递增。首次建立答卷草稿、提交、退回和任务状态变更也遵循 [04](04-data-model.md#5-任务与答卷状态) 的快照版本规则。

`getDetail` 的参与者配置不包含完整管理员快照；隐藏样品名称时连网络响应也不出现 `admin_name`。预先通过匿名链接取得全量配置再查分配，不符合本契约。

## 5. 答卷服务

```ts
type SaveDraftInput = VersionedMutation & {
  assignment_id: string;
  sample_id: string;
  config_version_id: string;
  answers: Answers;
};

type SubmitResponseInput = SaveDraftInput;

type ReturnResponseInput = VersionedMutation & {
  response_id: string;
  reason: string;
};
```

| 方法 | RPC | 返回 | 约束 |
| --- | --- | --- | --- |
| `ResponseService.get` | `api_get_response` | 当前答卷、版本、可见历史摘要 | 本人或管理员；他人请求不泄露存在性 |
| `ResponseService.saveDraft` | `api_save_response_draft` | `response_id, state, edit_version, saved_at` | 可部分填写；量程/类型仍校验；缺必答暂允许 |
| `ResponseService.submit` | `api_submit_response` | `SubmissionReceipt` | 完整校验；请求自身包含全部答案，无需假定上一次自动保存已完成 |
| `ResponseService.returnForCorrection` | `api_return_response` | `state=returned, edit_version, returned_at` | 管理员、非空原因、开放实验；不改旧修订 |
| `ResponseService.listRevisions` | `api_list_response_revisions` | `Page<RevisionSummary>` | 本人或管理员；历史按版本倒序 |
| `ResponseService.getRevision` | `api_get_response_revision` | 不可变提交与回执 | 与上述权限相同 |

自动保存必须串行或合并待保存请求，不能让前一个慢请求覆盖后一个快请求。提交前等待当前保存请求结束，再以最新版本和完整答案提交；若保存失败或版本未知，先重新读取再由用户决定。请求中不能包含可伪造的 `submitted_by`，提交人由会话决定。

首次保存或直接提交用 `expected_version=0`，服务端在同一事务建立唯一答卷。重复的 `assignment_id + sample_id` 由唯一约束和锁处理。相同幂等键/内容的提交重试返回相同 `revision_id`；不同内容复用键必须失败。

## 6. 分析与导出接口

| 方法 | 输入 | 输出 | 承载 |
| --- | --- | --- | --- |
| `AnalysisService.createSnapshot` | `experiment_id, expected_data_revision, idempotency_key` | `snapshot_id, data_revision, input_hash, config_version_id, created_at` | `api_create_analysis_snapshot`，管理员 |
| `AnalysisService.getSnapshot` | `snapshot_id`、游标、数量 | 冻结配置、纳入规则、排除计数、冻结行；分页不改变集合 | `api_get_analysis_snapshot`，管理员 |
| `AnalysisService.startInference` | `snapshot_id, idempotency_key` | `analysis_job_id, status` | 独立分析服务 `POST /v1/inference-jobs` |
| `AnalysisService.getAnalysisResult` | `analysis_job_id` | 状态或完整结果 | 独立分析服务 `GET /v1/inference-jobs/:analysis_job_id` |
| `ExportService.buildFile` | 冻结快照、`format=xlsx/csv/json`、允许的导出类型 | 浏览器 `Blob`、文件名、内容摘要 | 前端工作线程 |
| `AuditService.recordExport` | `snapshot_id, format, dataset_kind, idempotency_key` | 服务端审计编号 | `api_record_export`，管理员 |

`expected_data_revision` 与当前不符返回 `DATA_CHANGED`，让管理员刷新后重试。一个快照只属于一个实验，包含其全部冻结样品与指标；本版本不在看到结果后提供任意挑选比较的入口。快照必须保留精确的输入行/不可变修订引用，后续分页不能重新套用会变化的当前状态。

统计服务在服务端验证令牌、当前账户与管理员权限，再自行读取已授权快照。请求不接受客户端提供的原始评分矩阵。该服务可以是用户已有、适合运行成熟统计库的后端，不在 GitHub Pages 中运行，也不能假设 Supabase Edge Functions 内原生支持 SciPy。

M3 固定 `method_id=rm_gg_paired_t_holm_v1`、`alpha=0.05`，使用全部 `analysis_scale=interval` 指标的总体检验与全部样品对作为同一个 Holm 检验族。`ordinal` 指标仍有描述结果，推断标为不支持且不计入该参数检验族。详细公式和退化状态以 [07](07-statistical-analysis.md) 为准。

作业状态为 `queued/running/succeeded/failed`；接口失败不等于每个统计量都失败。某个指标不满足条件时，作业可成功返回该指标 `status=not_computable`、统计量 `null` 和原因。作业最长运行 `120s`，超时置失败；前端最多每 `2s` 查询一次，离开页面可停止查询，再进入可恢复查看。重复启动同一快照、方法和幂等键只获得同一作业。

结果至少包含：模式、输入哈希、方法/软件版本、创建时间、每指标有效完整人数、排除原因、总体 `F/df/epsilon/p_gg/p_holm`、每对差值/配对人数/`p_raw/p_holm`/未校正置信区间，以及评分模式复核结果。数值不可计算时是 JSON `null`，不能传 `NaN` 或伪造为 `0`。

真实模式导出只从已授权快照取数。`recordExport` 记录“发起导出”，不能据此声称用户已成功把文件保存到硬盘。默认不含邮箱、真实姓名。JSON 导出只用于配置或带模式标记的合成演示备份，不提供真实会话备份。

## 7. 错误字典

| `ErrorCode` | 典型情形 | UI 动作 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 会话缺失或过期 | 重新登录，保留内存编辑内容 |
| `FORBIDDEN` | 角色、分配或账户状态不允许 | 显示无法访问，不泄露对象详情 |
| `CONSENT_REQUIRED` | 未完成站点/实验告知 | 打开相应告知流程 |
| `NOT_FOUND` | 对有权用户而言对象不存在 | 返回列表；无权用户统一权限错误 |
| `VALIDATION_FAILED` | 配置、分数、文本或引用错误 | 字段级错误和摘要 |
| `EXPERIMENT_NOT_OPEN` | 未开放、已截止、关闭或到保留处置点 | 只读显示；解释具体本人可知原因 |
| `ASSIGNMENT_REVOKED` | 本人任务被撤销 | 禁止保存和提交 |
| `RESPONSE_LOCKED` | 已提交状态仍请求保存 | 展示已提交回执 |
| `VERSION_CONFLICT` | 预期编辑版本不符 | 展示最新版本与本地内容 |
| `IDEMPOTENCY_CONFLICT` | 同键不同请求摘要 | 停止自动重试并重新建立操作 |
| `DATA_CHANGED` | 分析创建时输入版本已变化 | 刷新数据再生成快照 |
| `RATE_LIMITED` | Auth 或 API 限流 | 尊重服务端等待时间，不循环猛重试 |
| `STORAGE_UNAVAILABLE` | IndexedDB 被禁用/配额不足 | 不宣称保存，提供内容取回 |
| `SERVICE_UNAVAILABLE` | 网络或服务不可用 | 显示可重试，不降级演示 |
| `INFERENCE_UNAVAILABLE` | 进阶服务未配置 | 描述统计可用；不生成假结果 |

适配器将 SDK/数据库具体异常映射为上述字典，日志保留请求号，不把堆栈、SQL 或令牌显示给用户。可重试写入必须使用原幂等键和原内容；权限、校验、版本冲突不能自动重试。

## 8. 必须同时验证的接口性质

- 同一套领域契约在演示与真实适配器运行，除持久化、身份可信性和审计承载外，业务结果一致。
- 参与者 A 请求参与者 B 的配置、答卷、修订、统计或导出均失败；修改请求中的用户 ID 无效。
- 伪造当前角色、跳过按钮、直接调用 RPC、直接修改表均不能绕过规则。
- 提交与关闭、撤销、退回、重复提交并发时只有一个合法结果，不产生半份修订。
- DTO 不含完整管理员配置、其他用户身份、密钥或令牌。
