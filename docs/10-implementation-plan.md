# 10 · 实现计划

> **给后续实现 Agent**：按任务逐项交付和验证。可用时采用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 执行；没有对应工具时按同一接口与验收契约实施。本轮仅编写计划，没有创建以下产品代码或运行命令。

**Goal**：发布完整的 GitHub Pages 演示，并在外部资源具备时交付真实协作与经过校核的进阶统计。

**Architecture**：React 静态前端通过统一接口装配演示或 Supabase 适配器。演示数据在 IndexedDB；真实身份、业务事务和权限由外部后端提供。进阶统计使用独立受控分析服务。

**Tech Stack**：React、TypeScript、Vite、pnpm、IndexedDB、Supabase、ECharts、一套 Excel 解析/生成库；M3 使用经验证的成熟统计库。

**Spec**：[产品需求](01-product-requirements.md)、[架构](03-architecture.md)、[数据模型](04-data-model.md)、[接口](05-api-contracts.md)、[配置](06-configuration-format.md)、[统计](07-statistical-analysis.md)、[验收](11-acceptance-tests.md)。

## 1. 全局约束

- 从最新 `dev` 派生临时分支并隔离工作，原子提交，经 PR 合回 `dev`；`main` 保持冷分支。接手时先读取当前仓库规则，保护已有未提交工作。
- 本地/用户授权环境构建，不添加 GitHub-hosted Runner 构建工作流；Pages 托管侧自身部署流程仍存在，见 [09](09-deployment-and-operations.md)。
- 中文浅色界面；`VITE_APP_MODE=demo/live` 显式选择；真实故障禁止静默改用演示。
- 每实验最多 `100` 人、`12` 样品、`30` 数值指标、`10` 文字题；配置版本 `1.0.0`；数字最多两位小数。
- `demo` 完整闭环和真实下载必须工作；`live` 必须由服务端验证权限与事务。
- 纯文档修改不强制跑产品测试；产品实现遵循仓库现有测试门禁，修改生产行为时同步维护相关测试。
- 测试数据独立构造，验证业务契约；不对持续变化的生产配置元素数量或整个键集合写死断言。
- 临时留痕放当前派生工作区的 `本地测试留痕/<对象>/<任务>/` 并忽略，不提交。Python 遵循适用环境规范，不新建/改动环境。
- 外部服务、邮箱发信和费用必须使用用户已拥有或已授权的资源。缺资源时完成可交付代码和清单，不能编造已经配置或部署。

## 2. 容易遗漏的五类行为

| 风险 | 用户应该得到的行为 | 负责任务 |
| --- | --- | --- |
| 自动保存返回顺序、双标签页和双设备修改 | 版本冲突明确，不丢新内容、不无声覆盖 | T03、T05、T09 |
| 真实服务异常、会话过期、存储不可用 | 不出现假成功；用户知道内容是否已保存 | T03、T05、T09 |
| 配置边界、编码前导零、公式与压缩异常 | 错误定位、无部分导入、无静默修正 | T02、T04 |
| 数据权限与当前状态绕过 | 直接 RPC/表访问仍拒绝越权和锁定后写入 | T08、T09 |
| 全量描述与完整配对不同、零方差和缺失 | 显示正确人数和不可计算原因，绝不伪造统计量 | T06、T11 |

## 3. 任务依赖与交付

| 任务 | 依赖 | 可验收产物 |
| --- | --- | --- |
| T01 基础与接口 | 无 | 可启动中文壳、类型、模式装配、工程命令 |
| T02 配置领域 | T01 | Schema 与语义校验、档位与评分规则 |
| T03 演示数据服务 | T01、T02 | 可持久化的完整领域接口与状态机 |
| T04 实验管理和导入 | T02、T03 | 创建、导入、发布、分配、关闭 |
| T05 评价员闭环 | T03 | 草稿、逐样品提交、回执、退回重提 |
| T06 描述统计与导出 | T03、T04、T05 | 冻结快照、真图表、真文件 |
| T07 M1 发布 | T04、T05、T06 | 可公开访问的 Pages 完整演示 |
| T08 后端权限和事务 | T01、T02 | 数据库迁移、RPC、权限验证 |
| T09 真实认证与适配器 | T05、T08 | OTP、建档、真实协作、跨设备 |
| T10 M2 运行交付 | T06、T09 | 真实站点、配置证据、保留/删除和恢复流程 |
| T11 M3 进阶分析 | T06、T08 | 权威统计服务、方法报告、数值核对 |
| T12 全链验收与文档同步 | 对应里程碑任务 | 可复现交付记录、无虚报能力 |

T08 可以与 T04–T07 并行，但必须共享已确定的领域接口，分别在隔离工作区提交。每阶段独立可交付，M2/M3 的外部资源问题不能阻塞 M1 发布。

## 4. 工程命令契约

T01 建立以下命令；表内是未来接口，不代表当前已存在：

| 命令 | 含义 |
| --- | --- |
| `pnpm dev` | 本地开发 |
| `pnpm typecheck` | TypeScript 无输出编译检查 |
| `pnpm lint` | 已配置的代码/基础资料校验 |
| `pnpm test -- <path>` | Vitest 指定领域测试 |
| `pnpm test:contract` | 适配器通用契约测试，明确列出实际运行的适配器 |
| `pnpm test:e2e` | Playwright 用户流程，明确使用演示或测试后端 |
| `pnpm build:demo` | 显式演示模式构建，Pages base 为 `/questionnaire/` |
| `pnpm build:live` | 校验真实公开配置后构建；缺配置报错 |
| `pnpm preview` | 本地查看构建产物，不作为生产服务器 |

真实测试后端必须与真实采集项目隔离。不把测试清库命令指向生产；没有测试环境就报告未验证范围，不能把只跑演示适配器称作“真实后端测试通过”。

## 5. 逐任务执行

### T01 · 工程基础和服务接口

**文件**：创建 `package.json`、`pnpm-lock.yaml`、`vite.config.ts`、`src/app/bootstrap.tsx`、`src/app/config.ts`、`src/services/contracts.ts`、`src/domain/types.ts`、`tests/app/config.test.ts`；按需更新 `index.html` 和根 `README.md`。

**接口**：实现 `loadAppConfig(env): AppConfig`、`createServices(config): Services` 的装配边界。`Services` 的方法以 [05](05-api-contracts.md) 为准，暂未实现的能力明确返回不支持，不构造假成功。

- [ ] 测试 `missing_mode_rejected`、`live_missing_public_config_rejected`、`demo_does_not_require_cloud_keys`，断言非法配置直接失败。
- [ ] 建立工程、锁定实际依赖和包管理器版本，记录官方兼容要求，加入中文页面壳和 HashRouter。
- [ ] 运行 `pnpm typecheck`、`pnpm test -- tests/app/config.test.ts`、`pnpm build:demo`，确认配置测试和静态构建通过。
- [ ] 提交可运行基础；当前欢迎页替换为应用壳的变更明确记录。

### T02 · 配置验证和评分规则

**文件**：创建 `src/domain/config.ts`、`src/domain/scores.ts`、`src/domain/states.ts`、`tests/domain/config.test.ts`、`tests/domain/scores.test.ts`。

**接口**：`parseConfig(input: unknown): Result<ExperimentConfig>`、`validateConfig(config): ValidationIssue[]`、`validateDraftConfig(input: unknown): Result<DraftExperimentConfig>`、`matchAnchor(indicator,value): Anchor | null`、`validateAnswers(config,answers,mode:'draft'|'submit'): ValidationIssue[]`。编辑配置草稿与正式配置分别验证。

- [ ] 用本目录 JSON 资料及额外独立构造数据测试：`4` 命中第二档、`7` 命中第三档、`10` 合法；`7.3` 不满足 `0.5` 步长；合法 `0` 不变成空值。
- [ ] 实现结构与语义两层验证、NFC/编码规范化、精确刻度和状态迁移；只填标题的实验草稿可保存、发布被拒绝；答卷草稿与提交也分开验证。
- [ ] 运行 `pnpm test -- tests/domain`，确认合法例通过、非法例得到指定错误类，未知字段不被丢弃。
- [ ] 提交领域规则及契约测试。

### T03 · 演示适配器和事务

**文件**：创建 `src/adapters/demo/database.ts`、`src/adapters/demo/services.ts`、`src/adapters/demo/seed.ts`、`tests/contracts/demo-adapter.test.ts`、`tests/contracts/service-cases.ts`。

**接口**：`createDemoServices(): Services`，实现 M1 所需的 [05](05-api-contracts.md) 接口。种子生成器只构造明确标记的示例，不使用真实资料。

- [ ] 写共享契约场景：发布冻结、逐样品完整提交、同键重试返回同一修订、退回保留历史、旧版本保存失败、截止/撤销后拒绝、实验告知未接受不能提交。
- [ ] 实现 IndexedDB 事务、版本检查、幂等记录、身份切换、种子初始化和重置；未实现推断能力返回关闭。
- [ ] 注入配额/事务失败，确认不显示成功、不产生半份提交；两标签页同版本写入只有一次成功。
- [ ] 运行 `pnpm test:contract`，报告实际覆盖 `demo`；提交。

### T04 · 管理页面和文件导入

**文件**：创建 `src/features/experiments/ExperimentEditor.tsx`、`ExperimentWorkspace.tsx`、`src/features/assignments/AssignmentManager.tsx`、`src/features/files/config-workbook.ts`、`src/workers/import.worker.ts`、`tests/files/config-workbook.test.ts`、`tests/e2e/admin-experiment.spec.ts`。

**接口**：`readConfigWorkbook(bytes: ArrayBuffer): Result<ExperimentConfig>`、`writeConfigWorkbook(config): Promise<Blob>`；页面调用 T03 服务，不直接改数据层。

- [ ] 测试合法 Excel/JSON 一致、`001` 不丢零、重复 ID/档位缺口拒绝、公式与超限文件拒绝、导入取消不保存。
- [ ] 实现五步向导、导入预检/预览、模板下载、复制、发布、分配、撤销、恢复、关闭与归档。
- [ ] 运行文件测试和 `pnpm test:e2e -- tests/e2e/admin-experiment.spec.ts`，确认发布后无法原地修改量程。
- [ ] 提交管理闭环；对话框关闭或验证失败保留用户输入。

### T05 · 评价员填写闭环

**文件**：创建 `src/features/responses/SampleForm.tsx`、`useDraftSave.ts`、`SubmissionReceipt.tsx`、`src/features/assignments/TaskList.tsx`、`tests/responses/draft-save.test.ts`、`tests/e2e/respondent-flow.spec.ts`。

**接口**：控件持有编辑态；保存/提交转换为 `Answers`，通过 `ResponseService` 工作。自动保存 `800ms` 去抖，串行化待处理版本。

- [ ] 测试未触摸滑杆仍为空、快慢保存返回次序不丢新值、提交携带最新答案、重复点击幂等、离开未保存提醒。
- [ ] 实现告知、固定样品导航、字段校验、保存状态、回执和退回重提；已提交只读。
- [ ] 模拟断网、存储异常、过期和版本冲突，保留当前输入并准确说明保存位置。
- [ ] 运行相关单元与浏览器测试，在 `360 × 800` 和桌面视口完成一次全流程；提交。

### T06 · 描述统计、图表和导出

**文件**：创建 `src/features/analysis/snapshot.ts`、`descriptive.ts`、`AnalysisWorkspace.tsx`、`src/features/files/result-export.ts`、`src/workers/export.worker.ts`、`tests/analysis/descriptive.test.ts`、`tests/files/result-export.test.ts`。

**接口**：`describe(values: number[]): DescriptiveStats`、`buildDescriptiveReport(snapshot): DescriptiveReport`、`buildExport(snapshot,format,kind): Promise<ExportFile>`。

- [ ] 用 [统计核对数据](examples/statistics-reference.json) 验证 SD 分母、type 7 分位数、`n=0/1`、合法零值；用独立实现复核预期。
- [ ] 实现快照固定、当前提交筛选、描述表/箱线/雷达、文字汇总、覆盖率和按需加载。
- [ ] 测试导出可重新打开，包含正确列和模式信息；公式样式文字按文本写出；用户数据不进入运行日志；图表与文件使用相同快照。
- [ ] 运行分析和导出测试，提交；进阶未提供时页面明确显示状态。

### T07 · GitHub Pages 演示上线

**文件**：创建 `scripts/prepare-pages.mjs`、发布产物标记模板，更新部署记录；具体产物在未来 `gh-pages` 分支根目录。

**接口**：准备脚本只复制已构建产物并生成含源提交 SHA、模式、构建时间的 `build-info.json`，不默认推送、不读取秘密配置、不修改 `main`。

- [ ] 用严格静态服务器验证 `/questionnaire/` 下深链接刷新、懒加载、模板与下载；不可只依赖开发服务器的路由回退。
- [ ] 按 [09](09-deployment-and-operations.md) 发布到 `gh-pages` 根目录；核对 Pages 设置后访问真实 URL。
- [ ] 在干净浏览器执行 `AC-01–AC-09` 等 M1 场景，验证新访客可独立初始化；记录线上构建 SHA。
- [ ] 提交部署记录和已实现状态，交付 M1，不等待 M2 资源才给出可访问网站。

### T08 · 数据库约束、RPC 与权限

**文件**：创建 `supabase/migrations/<时间>_domain.sql`、`<时间>_permissions.sql`、`<时间>_rpc.sql`、`tests/integration/permissions.test.ts`、`tests/integration/transactions.test.ts`。

**接口**：实现 [04](04-data-model.md) 实体与 [05](05-api-contracts.md) 的 `api_*`；所有业务写入原子校验。管理函数权限按 [08](08-security-and-privacy.md) 实现。

- [ ] 先定义匿名、A、B、管理员、停用用户权限测试；覆盖直接表访问、RPC、配置名称投影、角色自提权、假 `user_id`。
- [ ] 实现迁移、唯一约束、锁顺序、版本、幂等、当前状态检查、审核事件及一致性快照。
- [ ] 在隔离测试项目中复现关闭与提交竞态、双分配超限、重放提交和返回事务失败，确认无半写。
- [ ] 运行真实集成测试并记录测试项目标识的非敏感摘要；提交，不在生产填充测试答卷。

### T09 · 真实认证和跨设备协作

**文件**：创建 `src/adapters/supabase/client.ts`、`services.ts`、`src/features/auth/OtpPage.tsx`、`OnboardingPage.tsx`、`tests/contracts/supabase-adapter.test.ts`、`tests/e2e/live-collaboration.spec.ts`。

**接口**：`createSupabaseServices(config): Services`；OTP 通过官方 SDK，数据库身份用 `auth.uid()`。`sessionStorage` 使用专用键；不持久缓存真实答卷。

- [ ] 复用 T03 契约场景验证真实适配器，不把 SDK mock 当数据库授权验证。
- [ ] 实现注册、登录、过期、退出、站点建档、实验告知、任务和草稿同步；新身份不能自行成为管理员。
- [ ] 用两台设备或两个真正独立浏览器会话验证跨设备草稿、冲突和服务端回执；停用后旧令牌也不能业务读写。
- [ ] 配置不足时输出具体缺项，已有演示入口继续可用；真实错误不切模式。验证通过后提交。

### T10 · 真实站点、隐私生命周期与恢复

**文件**：创建受信运维命令/定时任务实现与说明，测试放 `tests/integration/privacy-lifecycle.test.ts`；更新 `docs/09-deployment-and-operations.md` 的实际部署记录。

**接口**：受信后台实现首次管理员授予、到期筛选/清理、删除请求处理、备份恢复；这些接口不可暴露给普通浏览器。删除需要核对请求与目标，保留最小处理审计。

- [ ] 将同一前端在适合登录应用的托管环境构建为 `live`，配置 Supabase、SMTP、域名和告知；没有必要不实现 Pages OAuth 可选分支。
- [ ] 验证过期验证码、重发限流、未同意阻断、最后管理员保护、到期数据处理、关联快照清理和删除请求处理。
- [ ] 用隔离恢复环境验证备份可读；公开产物扫描不含真实名单、答卷和服务器密钥；验证服务故障提示。
- [ ] 按 M2 验收交付真实地址、配置证据与当前未覆盖项；不能仅在本机成功就宣布上线。

### T11 · 进阶统计服务

**文件**：按可用运行环境创建 `services/analysis/`，提供 [05](05-api-contracts.md) 指定 REST 接口；数值核对放 `tests/statistics/`，前端结果页放 `src/features/analysis/InferencePanel.tsx`。

**接口**：`POST /v1/inference-jobs` 和 `GET /v1/inference-jobs/:analysis_job_id`；方法 ID、检验族及结果字段按 [07](07-statistical-analysis.md)。服务端读取快照，不相信浏览器评分矩阵。

- [ ] 先建立正常矩阵、`F=t²`、缺失、恒定差、零方差、有序量表和 Holm 的基准校核，保存预期来源与容差。
- [ ] 使用成熟库实现 RM-ANOVA/GG、配对 t、任务级 Holm 和评分模式复核；明确样本量及假设限制。
- [ ] 在合规环境运行独立数值核对、跨用户快照权限和作业超时测试；没有适合的环境则停止该部分验证，报告 M3 未完成，不能编造通过。
- [ ] 接入前端和导出，只有服务实际可用且验证通过才启用 `inference`；提交 M3。

### T12 · 里程碑验收与移交

**文件**：更新根 `README.md`、文档中的实际完成状态与命令；临时验证报告放忽略目录。

- [ ] 对照 [11](11-acceptance-tests.md) 执行当前里程碑全部适用场景，修复阻塞项。
- [ ] 运行仓库规定的提交前验证；记录命令、版本和真实结果，不将跳过项目写为通过。
- [ ] 检查文档接口与实际实现一致、相对链接有效、示例可导入、所有按钮有真实行为。
- [ ] 完成独立审查、PR 合并和远端读取确认；交付实际 URL、提交 SHA、模式、能力和剩余外部依赖。

## 6. 完成的含义

M1 完成：普通访客在 Pages 能走完管理和评价闭环，刷新有数据，图表来自实际答案，下载文件可打开。

M2 完成：独立设备共享真实数据库；越权和状态绕过被服务端拒绝；真实认证、同意与运行维护具备证据。

M3 完成：推断结果与可信参考一致，退化输入有明确状态，数据快照与方法可复现。

只写页面、只连通一个登录按钮、只生成迁移文件、只显示静态图表，均不满足对应里程碑。
