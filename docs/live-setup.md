# 真实服务接入与运维

## 当前交付状态

`M2` **尚未验收**。仓库没有已配置的 Supabase 项目、自定义 SMTP、独立真实站点或真实负责人资料。本次交付的是官方 SDK 适配器、数据库迁移、受信运维函数、账户接入界面与本地验证资产。不能据此声称真实 OTP、异地同步、直接权限攻击、并发提交或清理恢复已经验证。

`src/app/live.tsx` 的 `LiveApp` 支持真实 OTP 注册、登录、验证码核验、会话恢复、本人资料、站点告知建档、退出与删除申请。建档后通过 `LiveWorkspaceProvider` 接入共用工作区的实验创建/编辑/发布、评价员与任务分配、实验同意、草稿与提交、修订与退回、关闭/归档、冻结分析和导出。提供方及实际部署验收仍未完成；生产演示站点继续使用 `demo`，真实入口仅部署在独立 HTTPS 来源。真实服务失败不会切换到演示或产生合成成功结果。

`site_settings.ready` 默认 `false`，禁止完成建档与发布新实验。它是部署前开关，不替代已发布实验的撤站操作；紧急停用时应同时关闭真实前端入口、处理有效实验与账户权限。仅设置前端环境变量不能修改数据库负责人或授予管理员。

## 项目准备

1. 创建独立 Supabase 项目，记录实际区域、提供方、备份方案与实际费用。先在测试项目运行合成数据验收。
2. 启用邮箱 OTP，配置自定义 SMTP、发信域名与投递验证。将邮件模板改成显示 `{{ .Token }}` 的 OTP 模板；页面不处理 Magic Link 回调。按提供方设置有效期、频率限制及滥用防护。
3. 从可信 SQL 管理环境按文件名前缀顺序执行 `supabase/migrations/*.sql`；迁移是一次性初始化，不重复直接执行。需要 `pgcrypto` 与 `pg_jsonschema` 扩展。失败应停止，核对失败事务，不能忽略缺失扩展继续开放。
4. 检查 Data API 暴露的 schema。仅暴露应用需要的 `public` RPC；`app_private` 不加入 exposed schemas。业务表位于 `app_private`，全部开启 RLS、撤销浏览器角色权限，没有允许浏览器直读或直写的策略。
5. 根据 `supabase/configure-site.example.sql` 填入实际负责人、联系方式、用途、服务及区域、保留起点和期限、删除渠道与下载责任。模板故意保持 `ready=false`。测试环境可在配置完成后打开就绪开关开展合成测试；生产环境必须保留为关闭，直至真实验收完成。
6. 可信维护人员每日检查实验采集边界、清理到期日、删除申请与运维日志期限。记录负责人、检查频率、备份窗口及重放演练，不能把本仓库描述为已经配置了定时器。

在独立托管环境设置下列浏览器公开配置，构建后检查来源：

```dotenv
VITE_APP_MODE=live
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE
VITE_LIVE_ORIGIN=https://YOUR_REAL_HOST
VITE_PRIVACY_CONTROLLER=实际负责人
VITE_PRIVACY_CONTACT=实际联系渠道
VITE_PRIVACY_NOTICE_VERSION=实际告知版本
```

这些值都会进入公开构建。只允许 publishable key，不允许 `secret`、`service_role`、数据库密码、SMTP 密码或分析服务密钥。适配器要求真实 HTTPS 来源与 `VITE_LIVE_ORIGIN` 的 origin 一致，拒绝 `github.io`；本地合成测试可使用 mock SDK 或受控 HTTPS 测试域名。隐私环境变量供站点公开展示使用，权威告知来自受信数据库配置。

## 首位管理员

在测试环境真实注册并完成站点告知后，由数据库所有者核实其 Auth UUID，执行：

```sql
select app_private.grant_admin('REPLACE_WITH_VERIFIED_AUTH_UUID'::uuid, '实际授予原因和受信工单号');
```

`grant_admin` 不暴露于 Data API，且已撤销 `PUBLIC`、`anon` 与 `authenticated` 的执行权限。它记录最小授予审计。Auth 新用户只获得服务端创建的 `participant` 与 `pending_consent` 资料；完全忽略可伪造的用户元数据角色。生产初始化应在受控测试窗口完成并重新检查就绪状态。没有默认管理员密码或公开提权入口。

## 适配器与返回值

```ts
const adapter = createSupabaseAdapter({ url, publishableKey, liveOrigin }, clearUserMemory);
await adapter.sendOtp({ email, intent: 'register' });
await adapter.sendOtp({ email, intent: 'login' });
await adapter.verifyOtp({ email, token });
await adapter.getSession();
await adapter.service('getMe');
await adapter.service('getAssignment', { assignment_id });
await adapter.execute('submit', { assignment_id, sample_id, config_version_id, answers, expected_version, idempotency_key });
await adapter.signOut();
```

所有方法返回 `Result<T>`。`getSession` 通过官方 `getUser` 验证当前身份，仅返回 `user_id` 与邮箱摘要，不向组件返回令牌。SDK 会话仅存于 `sessionStorage` 的 `questionnaire:live:<project-ref>:auth:v1` 独立命名空间，`project-ref` 取服务 URL 主机名的首段；业务答卷不写入持久存储。关闭该浏览器会话后不保证仍登录。退出通过官方 `scope=local` 清理当前会话与页面数据，并显式返回当前会话的远端撤销是否确认，不退出其他设备。

`rpcMethods` 导出 [05](05-api-contracts.md) 的完整 RPC 映射；`service(method,input)` 调用对应方法，`call(rpc,p_input)` 只允许该白名单。`execute` 兼容演示的写操作名称，其中 `returnResponse` 映射到 `returnForCorrection`；演示身份切换、重置与身份创建均被拒绝。

`loadLiveWorkspace` 逐个调用服务端白名单接口，遍历全部分页并把已授权 DTO 映射为界面内存状态；不提供下载整库的 `read()` RPC。当前角色只取自 `getMe` 和管理员授权的参与者列表，角色缺失会停止读取。管理员列表只读取配置、评价员和任务/答卷状态摘要，不逐个下载全部答案或历史；一个实验 `100` 人、每人 `12` 个样品的基础装配为 `5` 次 RPC（不计超出单页的列表）。摘要带 `is_summary=true`，空答案数组只表示该视图未取答案，不能当作实际空答卷。

评价员只读取本人任务和参与配置投影；当前样品路由才读取当前本人答卷与最新修订，记录路由才读取所选答卷全部历史。若服务意外返回他人任务或管理名称，客户端拒绝继续装配。保存、提交、同意、退回及任务状态变更后，只回读当前身份、受影响任务和当前路由所需答卷；不重新遍历全站历史。`audit_events` 不提供浏览器列表，界面将其保持为空。

`LiveWorkspaceProvider` 不创建 IndexedDB、浏览器业务缓存或广播演示身份；答卷、修订和快照只在当前页面内存中，退出时清空。写入成功后重新读授权状态，刷新失败单独提示，不把已确认写入误称为保存失败。暂时失败后重复相同请求会复用原幂等键。自动保存的版本和时间来自服务端回执。管理员建立快照后读取全部冻结行分页，核对各页快照标识、输入哈希、配置与数据版本，再把 `mode=live,is_synthetic=false` 的冻结对象交给描述统计及文件工作线程；不把真实数据标为演示。

关键 DTO 的接入差异：

| 调用 | 数据结构 |
| --- | --- |
| `getMe` | 本人资料、当前角色、站点告知、版本与 `site_ready` |
| `getAdminDetail` | `config`、实验状态和版本、冻结隐私和保留策略 |
| `getAssignment` | 任务、服务端真实归属、`experiment` 元数据、`config` 参与者投影、冻结告知、同意时间与样品状态；不含管理名称 |
| `getResponse` | 答卷或 `null`；答案字段为 `answers`，退回字段为 `return_reason` |
| `createSnapshot` | 快照标识、数据版本、输入哈希与配置版本摘要 |
| `getSnapshot` | 冻结配置、覆盖、排除修订和计数；`rows` 为 `{items,next_cursor}` |

列表默认 `50` 项、最大 `100` 项，继续传回 `next_cursor` 至 `null`。修订列表倒序，其余列表按创建时间与 UUID 升序。不要把第一页当全部数据。快照分页只读取已经冻结的行，不重查当前答卷。浏览器复用现有文件工作线程；真实导出前须通过 `recordExport` 核验当前管理员权限并记录发起导出，其回执不表示文件已写入磁盘。当前没有真实推断服务，不能显示假检验结果。

写入不自动重试。网络结果不明时应保留同一幂等键及完整原请求，再显式重试；改变答案或预期版本时重新建立请求。`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、权限与校验错误不自动覆盖。当前 V1 用一个数据库事务锁序列化业务 RPC，优先保证关闭、撤销、停用、提交与快照的一致性，吞吐能力需真实负载验证。

## 保留与可信清理

每天在受信 SQL 环境查询下列清单，按冻结策略执行：

```sql
select e.experiment_id, e.status,
       app_private.end_at(e,v) as collection_ends_at,
       app_private.end_at(e,v) + make_interval(days => (v.retention_policy->>'retention_days')::integer) as retention_due_at
from app_private.experiments e
join app_private.experiment_versions v on v.config_version_id=e.config_version_id
order by retention_due_at;

select request_id, user_id, created_at
from app_private.deletion_requests where status='pending'
order by created_at;
```

有效采集结束取计划截止、实际关闭及发布后最长采集天数中最早者；空截止默认也不能无限采集。保存、提交和退回每次查服务端时钟，无需后台任务改状态。默认保留 `180` 天、最长采集 `365` 天，当前实现只允许在该默认上限以内缩短，延长需另行设计、告知和验证。

清理前先在独立受限运维系统保存最小删除重放清单，包含待清理实验或用户 UUID、完成时间与备份轮换窗口；不保存答案或邮箱。确认该清单可在恢复备份时重放，再由数据库所有者执行：

```sql
select app_private.purge_experiment('VERIFIED_EXPERIMENT_UUID'::uuid, '受限备份重放清单的实际回执');
select app_private.fulfill_deletion('VERIFIED_DELETION_REQUEST_UUID'::uuid, '受限备份重放清单的实际回执');
```

`purge_experiment` 只允许已经到期的发布实验，原子删除答卷、全部修订、任务、配置、快照、可关联幂等结果及审计。`fulfill_deletion` 只处理核验过的待处理申请，删除该用户全部业务关联，同时作废受影响实验的整份冻结快照、递增数据版本；不误删同实验其他评价员答卷。最后一位有效管理员受保护。两者只留下不含用户、实验或答卷标识的清理批次计数，并清除超过 `180` 天的清理记录与常规审计。

个人删除是两阶段流程：上述函数完成活动业务数据清理后，可信维护人员必须通过官方 Admin API 或控制台删除相应 Auth 身份、撤销会话，并处理 Auth/SMTP/运行日志与已下载文件。函数明确返回 `auth_identity_deletion_required=true`，不能将业务清理称为账户已完全删除。业务资料被清除后，残留 Auth 身份也无法访问业务 RPC。到期实验清理不自动删除还参与其他实验的身份；不再必要的个人资料应另走核验删除流程。

备份、提供方日志、浏览器已下载文件与独立推断服务不受 SQL 清理函数控制。默认备份和重放清单窗口不得超过 `180` 天；清单到期后由受信运维系统清除。恢复备份必须先隔离访问，重新执行删除清单及已到期实验清理，再验证无残留快照/修订后开放。无法核验原账户时走公开联系人渠道，不通过匿名邮箱查询泄露参与情况。

## 已执行验证与剩余门禁

已执行 `pnpm exec vitest run tests/live.test.ts`：官方 SDK 的 mock 测试和迁移静态保护检查。已执行 `pnpm exec tsc -b`。可选 `supabase/tests/pglite-smoke.mjs` 在 PostgreSQL WASM 运行迁移及合成业务流程；测试替换了 Auth 与 `pg_jsonschema`，所以仅证明 SQL 可执行及该合成流程，不证明真实 Supabase 身份、Schema 扩展或 RLS 验收通过。

可在项目外独立安装 `@electric-sql/pglite` 后运行该补充检查，不向生产包添加依赖：

```powershell
$env:PGLITE_PACKAGE='C:/path/to/node_modules/@electric-sql/pglite'
node supabase/tests/pglite-smoke.mjs
```

正式开放前必须完成 [08](08-security-and-privacy.md) 与 [11](11-acceptance-tests.md) 的真实验收，至少包括：

- 实际 SMTP 的注册/登录发送、验证码过期与限流、无效账户通用提示、退出失败、本地数据清理。
- 两个评价员、管理员、未登录、未建档与停用账户的直接 RPC/表访问；伪造角色、任务、样品、配置与旧 JWT、旧幂等键的拒绝。
- 两台设备同账户恢复服务端草稿，冲突处理，提交与关闭/撤销/退回的并发原子性、相同幂等键回执一致与失败事务无残留。
- 实际 `pg_jsonschema` 对未知字段、Unicode、日期、两位小数、步长、档位、重复引用及必答规则的验证；SQL规范化哈希与前端 JCS 哈希的样例对照。
- 分页完整性、当前有效样品数据集、历史修订排除、停用与恢复后的快照过时标识、真实参与者网络响应没有管理名称。
- 合成数据到期清理、个人删除、Auth 身份删除、快照不可恢复与备份恢复后重放；负责人签收每日执行责任。
- 真实答卷、管理、导出界面的端到端联调与直接权限验收，以及独立托管的安全配置、缓存和浏览器存储检查。

未完成上述步骤前保留 `M2` 未验收标记。这里没有宣称已经接入自动清理调度或独立推断服务。

## 官方依据

于 `2026-11-06` 重新核对：[官方 OTP 登录与注册开关](https://supabase.com/docs/reference/javascript/auth-signinwithotp)、[官方邮箱验证码核验](https://supabase.com/docs/reference/javascript/auth-verifyotp)、[自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[数据库函数与执行权限](https://supabase.com/docs/guides/database/functions)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[pg_jsonschema 扩展](https://supabase.com/docs/guides/database/extensions/pg_jsonschema)。这些资料说明平台能力，不替代本项目真实权限与部署证据。
