# 07 · 统计分析

## 1. 范围与固定决策

本章的默认值、计算门槛、检验族及错误处理是**本项目设计决定**；所引统计文档用于说明算法和适用限制，不替本项目作产品决策。

| 阶段 | 必须真实实现 | 不可冒充的能力 |
| --- | --- | --- |
| M1 | 浏览器根据冻结数据计算描述统计、箱线图、雷达图并导出 | 不输出预制 p 值、显著性星号或字母分组 |
| M2 | 沿用相同计算口径，数据来自真实授权服务 | 本地演示身份不等于真实多人数据 |
| M3 | 受控后端执行重复测量推断及留一法评分模式复核，返回可追溯结果 | 服务未部署、不可用或未通过验收时，不能宣称已提供推断 |

M3 方法标识固定为 `rm_gg_paired_t_holm_v1`，双侧比较，`alpha=0.05`。流程为：**每指标完整配对 → 重复测量 ANOVA（始终 GG 校正）→ 全部样品配对 t 检验 → 一个 Holm 检验族**。不先看总体检验是否显著再决定计算哪些比较。

每个数值指标发布时冻结 `analysis_scale='interval'|'ordinal'`。`interval` 表示研究方案按等距评分分析；输入控件是滑杆、整数或档位，均不能替代这一声明。`ordinal` 在 V1 仅提供描述统计，推断返回 `UNSUPPORTED_SCALE`。量表类型不能根据观察到的结果或一次正态性检验自动切换。

同一评价员评价全部样品，属于配对的重复测量设计，不能把全部评分当作独立样本。评价员作为区组控制平均打分水平差异；区组模型的依据见 [STAT1](#stat1)。每个“评价员 × 样品 × 指标”只有一次评分，不能分离评价员与样品交互和纯重复误差，也不能估计重测重复性。

主方法以评价员之间独立、被试内对比近似正态为适用前提；配对 t 的正态假设针对差值，小样本时尤其重要。GG 只处理球形性，不修复顺序混杂、非独立评价员或错误量表含义。V1 只有固定建议呈送顺序，未记录实际品尝顺序，因此不声称已经控制顺序或残留效应。

## 2. 冻结数据与纳入规则

V1 一次分析针对**一个实验的全部已发布样品和全部指标**，不接受客户端指定样品、指标、评价员子集。页面筛选只控制展示，不能重算检验族或重新解释为一次独立分析。规模上限为 100 名评价员、12 个样品、30 个数值指标。

按 [04 · 统计数据集](04-data-model.md#7-统计数据集)，在同一一致性读取中纳入：账户激活、任务 `active`、答卷当前 `submitted`、`latest_revision_id` 指向的修订与冻结配置一致。历史提交不与最新修订叠加。退回时即排除旧提交，撤销任务或停用账户也排除；重新提交或恢复后，新的分析按当前状态重新判断。

快照至少保存 `snapshot_id`、`experiment_id`、`config_version_id`、`data_revision`、`revision_ids`、模式、UTC 截止时间、冻结配置、纳入/排除清单及 `input_hash`。哈希使用确定性规范化后的配置和输入数据，不只哈希记录数；规范化版本也须留存。账户激活状态、任务覆盖/状态或有效修订变化后递增 `data_revision`，包括新增任务和首次建立答卷草稿；具体规则见 [04](04-data-model.md#5-任务与答卷状态)。旧结果标记过时，原数值保持不变，导出复用同一个快照。

数值答案为 `{indicator_id, value: number|null, missing_reason: string|null}`。缺失不补 0，不用均值填充；有效的 0 不能当缺失。文本不自动转分。对每个样品、指标，分别列出有效分数、可选未填、无法评价及未取得有效提交的数量；缺少有效提交不等同于已提交但未填。

推断按指标构造矩阵：行是稳定评价员 ID，列是冻结样品 ID。该评价员在**全部样品**对该指标都有有效分数才保留。不同指标可有不同完整配对人数，同一指标的 ANOVA、配对比较及关联图表必须使用相同评价员集合。完整案例处理及其数据损失限制见 [STAT2](#stat2)。报告须保留缺失分布；完整配对不代表已经消除选择性缺失造成的偏差。

`participant_id` 仅是服务分析矩阵或长表的内部列别名：其值来自现有 `user_id`，或快照内与该用户一一对应的稳定 `participant_code`。不得新增另一套业务 ID，也不得用可变昵称配对；对外展示和导出仍按 04 使用稳定代号。

统计报告列出各指标完整人数、未纳入人数和原因。构造矩阵必须检查单元格唯一性；禁止使用会默默平均重复记录的透视操作。任何排除均不能由“与群体不一致”“相关低”或“分数极端”自动触发。

## 3. M1 描述统计和图表

### 3.1 有效值、离散与分位数

各样品、各指标使用当前快照中全部有效分数计算 `n`、均值、样本 SD、中位数、Q1、Q3、最小值、最大值。均值与 SD 在 `ordinal` 指标上仍可作为数值编码摘要，但必须标明有序评分，主展示中位数、四分位数和取值分布，不据编码均值作等距推断。

$$
\bar x=\frac{\sum_i x_i}{n},\qquad
s=\sqrt{\frac{\sum_i(x_i-\bar x)^2}{n-1}}
$$

`n=0` 时除计数外的统计量均为 `null`；`n=1` 时均值和分位数等于该分值、`sd=null`；`n>=2` 且分数全相同时 `sd=0`。计算前不舍入，展示精度不影响后续运算。

分位数固定使用 **Hyndman–Fan type 7**，与 R `quantile(type=7)` 一致，见 [STAT3](#stat3)。排序后用从 0 开始的下标，令 `h=(n-1)p`、`j=floor(h)`、`g=h-j`，计算 `Q(p)=(1-g)x[j]+g*x[min(j+1,n-1)]`；Q1、中位数、Q3 分别取 `p=0.25,0.5,0.75`。

箱体为 `[Q1,Q3]`，`IQR=Q3-Q1`。下须是所有 `x>=Q1-1.5*IQR` 中的最小**实际观测值**，上须是所有 `x<=Q3+1.5*IQR` 中的最大实际观测值；围栏本身不是须端。围栏外评分画为单独观测点，仍参与统计，不自动删除。图表库必须接受这些预计算结果，不得换用默认分位数或须定义。`IQR=0` 仍按相同规则处理。

M1 默认不提供 CI；若展示误差线，明确标记“均值 ± 样本 SD”。SD 描述评价员之间的离散，不是均值置信区间。

### 3.2 雷达及数据口径

不同量程统一用发布配置的上下界转换：`z=100*(x-L)/(U-L)`，轴固定为 0～100。原始值、单位、范围和有效 n 保留在提示、数值表和导出中；`U<=L` 是配置错误。禁止按本次观测最小、最大值拉伸，禁止把强度指标自动解释成越高越好，也不自动反向计分、合成质量总分或按雷达面积排名。

“概况”图可以使用逐样品可用数据，标记各自 n。M3 的比较图必须使用该指标的完整配对子集，不能将全量均值配上另一子集的显著性标记。雷达只显示轮廓，不承载显著性结论。

## 4. M3 主算法

### 4.1 前置条件与重复测量 ANOVA

每个 `interval` 指标要求 `k>=2` 个样品、`n>=3` 名完整评价员。三人是**工程最低门槛，不代表样本充分或检验能力足够**。独立单位数是 n，不是 `n*k`。

令 `y[i,j]` 为第 i 人对第 j 样品的分数；行均值、列均值和总均值分别为 $\bar y_{i\cdot}$、$\bar y_{\cdot j}$、$\bar y_{\cdot\cdot}$。

$$
SS_S=n\sum_j(\bar y_{\cdot j}-\bar y_{\cdot\cdot})^2,
\qquad SS_B=k\sum_i(\bar y_{i\cdot}-\bar y_{\cdot\cdot})^2
$$

$$
SS_E=\sum_{i,j}(y_{ij}-\bar y_{i\cdot}-\bar y_{\cdot j}+\bar y_{\cdot\cdot})^2,
\quad df_1=k-1,\quad df_2=(n-1)(k-1)
$$

$$
F=\frac{SS_S/df_1}{SS_E/df_2}
$$

直接对残差平方求和，避免多个大平方和相减。可报告明确命名的偏 $\eta_p^2=SS_S/(SS_S+SS_E)$，不得标成广义 $\eta^2$；评价员区组项不输出“评价员合格性 p 值”。

令 V 为样品列的样本协方差矩阵，$H=I-\mathbf1\mathbf1^T/k$，$A=HVH$。当 `k>2` 时：

$$
\epsilon_{GG}=\frac{\{\operatorname{tr}(A)\}^2}{(k-1)\operatorname{tr}(A^2)},
\quad df_{1,GG}=\epsilon_{GG}df_1,\quad df_{2,GG}=\epsilon_{GG}df_2
$$

`k=2` 时固定 `epsilon=1`。保持原 F，用校正自由度的 F 分布右尾计算 `p_gg`。理论范围为 `1/(k-1)<=epsilon<=1`；只允许修正浮点容差内的越界，明显越界返回数值错误。上述投影矩阵形式与正交对比公式等价，见 [STAT4](#stat4)。

**所有可计算的总体检验都采用 GG，不由 Mauchly 检验结果决定是否校正。** `statsmodels.AnovaRM` 单独使用不能实现此承诺，其官方文档说明尚未实现球形性违背校正，见 [STAT5](#stat5)。

### 4.2 全部两两配对比较

对每对样品 a、b，使用同一完整配对组，令 $d_i=y_{ia}-y_{ib}$：

$$
t=\frac{\bar d}{s_d/\sqrt n},\qquad df=n-1
$$

使用 t 分布双侧概率，输出方向固定为“a 减 b”的原始单位均值差，不能将它误称为独立样本比较。实现参考 `scipy.stats.ttest_rel`，见 [STAT6](#stat6)。

可提供 $\bar d\pm t_{0.975,n-1}s_d/\sqrt n$，列名必须为“95% CI（未作多重校正）”。显著性只由 Holm 后 p 判断；该 CI 可能与校正后判断不同。不能通过各样品均值 CI 是否重叠判断配对差异。

### 4.3 唯一检验族与结果标记

令 $D_I$ 为冻结配置中**全部 `interval` 指标数**。每指标规划 1 个总体检验和全部 `k*(k-1)/2` 个配对检验，合计：

$$
M=D_I\left(1+\frac{k(k-1)}2\right)
$$

`ordinal` 不属于参数检验族，但在结果中明确列为不支持。全部为 `ordinal` 时 `M=0`，不执行 Holm，仍提供描述结果和不可计算说明。最多规划 2010 个检验。

总体检验送入 Holm 的是 `p_gg`，配对检验送入原始双侧 p。计划内不可计算项仍占 M 的位置，只在校正内部以 1 占位；对外 p 始终为 `null`。不能因缺失、零方差或 p 大而缩小检验族。`k=2` 时总体与唯一配对检验等价，仍保留预定的两个位置，不根据计算结果去重。

将 p 升序排列后计算：

$$
p^{Holm}_{(i)}=\min\left(1,\max_{j\le i}\{(M-j+1)p_{(j)}\}\right)
$$

再映射回原检验；相同 p 用稳定检验 ID 排序以保持输出可复现。Holm 在任意依赖结构下控制家族错误率，依据见 [STAT7](#stat7)。本项目的结论边界是这一份任务的完整预定检验族，不是用户反复查看、多次生成报告之后的全部研究活动。

显示 `p_holm<0.05` 为检出差异，否则为“未检出差异”，不得写“证明相同”。极小 p 使用如 `p<0.001` 的展示，不将显示精度造成的 0 当作严格概率零。默认提供差值表或校正 p 矩阵，不提供 Tukey HSD 或字母分组；共享字母不能证明等效，见 [STAT8](#stat8)。

### 4.4 M3 必做：评分模式复核

本功能对应 `REQ-21`、`T11` 和 `AC-31`。按**单一 interval 指标、与该指标推断完全相同的完整配对子集**计算，不合并指标、不生成跨指标总分。要求 `n>=3`、`k>=2`；未进入该子集的评价员只列未纳入原因，不另取零散评分作诊断。ordinal 返回 `UNSUPPORTED_SCALE`。

对评价员 i，逐样品计算排除其本人后的参考均值及偏离：

$$
m_{-i,j}=\frac{1}{n-1}\sum_{\ell\ne i}y_{\ell j},\qquad e_{ij}=y_{ij}-m_{-i,j}
$$

$$
\operatorname{mean\_bias}_i=\frac1k\sum_j e_{ij},\qquad
\operatorname{RMSE}_i=\sqrt{\frac1k\sum_j e_{ij}^2}
$$

两者保留原始评分单位。平均偏差为正表示整体高于其他人的参考均值；RMSE 的分母是 k，不是 `k-1`。留一均值是群体参考，不是正确答案；偏离可能来自真实偏好。不同量程的 RMSE 或偏差不能直接用于跨指标比较或人员总排名。

只有 `k>=3` 才计算个人样品轮廓与留一参考轮廓的 Pearson r。令 $\bar y_i$ 和 $\bar m_{-i}$ 分别为两个轮廓在 k 个样品上的均值：

$$
r_i=\frac{\sum_j(y_{ij}-\bar y_i)(m_{-i,j}-\bar m_{-i})}
{\sqrt{\sum_j(y_{ij}-\bar y_i)^2\sum_j(m_{-i,j}-\bar m_{-i})^2}}
$$

`k=2` 时仅 r 为 null，原因是 `INSUFFICIENT_PROFILE_POINTS`，RMSE 和平均偏差仍可算。任一轮廓为常数时 r 为 null，原因是 `CONSTANT_PROFILE`。近常数预检查使用本项目固定的数值规则：非恒定向量 v 若满足 `norm(v-mean(v)) < 1e-13*abs(mean(v))`，其中 norm 为欧氏范数，r 返回 `NUMERICAL_FAILURE`；锁定版本的库若发出 `NearConstantInputWarning`，也按数值失败处理，不忽略警告继续展示。常数和两点相关边界的依据见 [STAT9](#stat9)。

每个输出项独立记录状态：r 不可计算不清空仍有效的 RMSE/偏差，ANOVA 或配对 t 退化也不阻止可计算的复核结果。若使用 `scipy.stats.pearsonr`，只读取 r 并处理警告，**不输出其 p 值或置信区间，不加入 Holm 检验族**。按稳定代号展示，不生成评价员优劣名次、合格阈值或自动剔除决定；r 高也不证明绝对一致，例如整体加 5 分仍可能 r=1。本设计没有重复评分，这些量不称为重测信度；ICC 等高级可靠性分析仍属后续扩展。

## 5. 不可计算、数值安全与复核

| 代码 | 条件与处理 |
| --- | --- |
| `NO_DATA` | 没有有效分数，描述值及推断值均为 null |
| `UNSUPPORTED_SCALE` | ordinal 的 V1 推断不支持，保留描述数据 |
| `INSUFFICIENT_SAMPLES` | 少于两个样品，无总体或配对推断 |
| `INSUFFICIENT_COMPLETE_SUBJECTS` | 完整人数少于三，保留人数、排除原因和可用描述 |
| `ZERO_RESIDUAL_VARIANCE` | `SS_E=0`，F 和总体 p 不可计算 |
| `ZERO_PAIR_DIFF_VARIANCE` | 配对差值全相同，包括全为零，t 和配对 p 不可计算；均值差仍展示 |
| `INSUFFICIENT_PROFILE_POINTS` | 少于三个样品，评分模式复核的 r 不可计算；满足其他条件的 RMSE/偏差仍保留 |
| `CONSTANT_PROFILE` | 个人轮廓或留一参考轮廓为常数，r 未定义，返回 null |
| `NUMERICAL_FAILURE` | 分布计算失败、非有限输出、明显非法 epsilon 或轮廓近常数导致相关计算不可靠；不得回退为 0 或 1 |
| `INVALID_VALUE` | 非有限、越界、步长非法或答案结构非法；输入校验失败，拒绝快照或使任务失败 |
| `DUPLICATE_CELL` | 稳定 ID 对应多个输入单元格；拒绝处理，不平均、不取任意一条 |

先检查结构性坏输入；有效输入中的单项依次检查量表、样品数、无有效数据、完整人数、零变异，最后检查数值计算结果。每项记录首个适用原因，诊断信息可补充其他问题，不能因顺序不同产生不同统计口径。

一列分数全相同本身不禁止分析；必须检查相应残差或配对差值。`SS_S=0` 且 `SS_E>0` 时 F=0、p=1 是合法结果。零变异预检查按保存的两位小数精确值判断，可用定点整数计算差值，避免把浮点残差当成真实方差。接近零但无法可靠计算的情况返回数值错误，不制造极端显著性。

JSON 用 `null` 表示不可计算，不序列化 NaN/Infinity。某个指标或比较不可计算时，其他有效结果仍保留；一个不可计算的总体检验不自动删除其预定比较。结构性坏输入不作为普通缺失悄悄跳过。

V1 不按 RMSE、相关、箱线离群点或作答时间自动剔除任何人。M3 的评分模式复核按 §4.4 实现，其结果不改变纳入集合，也不改变检验族或推断统计。

## 6. 后端接入契约与实现路径

逻辑接口及公共错误封装以 [05 · API 契约](05-api-contracts.md) 为准，本章约束统计语义：

| 调用 | 输入与必须行为 | 返回 |
| --- | --- | --- |
| `AnalysisService.createSnapshot` | `{experiment_id, expected_data_revision, idempotency_key}`；管理员授权、版本校验和同一事务冻结全部配置与输入 | `{snapshot_id, data_revision, ...}`；真实实现为 RPC `api_create_analysis_snapshot` |
| `AnalysisService.startInference` | `{snapshot_id, idempotency_key}`；外部服务重新验证身份及当前管理员权限，只读取授权快照 | `{analysis_job_id, ...}`；`POST /v1/inference-jobs` |
| `getAnalysisResult(analysis_job_id)` | 每次查询仍校验当前授权，返回同一输入及方法版本的结果 | `GET /v1/inference-jobs/:analysis_job_id` |

客户端不上传评分矩阵覆盖快照，不指定子集、alpha 或任意执行代码。统计服务使用最小权限的服务端凭据读取冻结输入，浏览器不持有管理密钥。相同幂等请求返回同一任务，不创建重复任务；排队和执行状态由 05 定义。输入变化只令旧结果 `stale=true`，不在原任务内换数据重算。

业务上不可计算的单项结果采用 `status='not_computable'`、`reason_code` 和空推断字段；可计算项为 `status='ok'`。已完成结果的正常读取返回 HTTP 200，包括过时或含不可计算项的结果。认证、网络、结构损坏或服务整体失败使用公共错误封装，不伪装成成功统计。暂时故障保留错误与重试入口，不切换演示数据。

返回和导出至少包括：

- 快照/任务 ID、输入 hash、数据版本、修订 ID 集合、方法 ID、软件版本、计算时间、运行模式、过时标记、固定 alpha 和检验族 M。
- 每指标纳入及排除人数、样品顺序、完整配对子集的描述结果。
- 总体结果：SS、原始及 GG 自由度、F、epsilon、`p_gg`、`p_holm`、偏 eta 平方及状态。
- 配对结果：a/b、n、均值差、差值 SD、t、df、`p_raw`、`p_holm`、明确标注的可选 CI 及状态。
- 评分模式复核：每指标、每评价员代号的 n、k、留一参考轮廓、RMSE、平均偏差、r，以及各输出项独立的状态和原因码；不包含相关显著性 p 或质量排名。

可行实现为独立受控统计服务：验证输入 → 按指标严格 pivot 和完整配对 → 分项检查退化条件 → `pingouin.rm_anova` / `scipy.stats.ttest_rel` 及 §4.4 留一复核 → 仅对预定假设检验执行一次 Holm → 持久化不可变结果。ANOVA 显式指定 `dv='value', within='sample_id', subject='participant_id', correction=True, detailed=True, effsize='np2'`，避免库默认输出另一种效应量；此处 `participant_id` 是 §2 定义的内部别名。`k=2` 时将库的未校正 p 规范化为 `p_gg`，epsilon 固定为 1。锁定依赖版本，并使用本章公式及参考数据交叉核对。若选择 Python，只使用当时经项目规则确认的既有合规环境；本规范不授权创建或修改环境。

**不假设 Supabase Edge Functions 原生提供 Python、SciPy 或 Pingouin。** 数据库 RPC/边缘函数可以负责授权和任务编排，统计运行时是另行部署的服务。数学上这些计算也可在浏览器实现，但本项目规定正式 M3 结果以后端为权威；M1 的描述计算仍真实运行。无可用统计服务或未实现 M3 时 `Capabilities.inference=false`，UI 不调用推断接口、不返回假 p 值。

## 7. 实现验收对照

下表是实现时必须运行的核对用例，不表示本规范阶段已经执行了统计程序。与 05 的接口用例及 `examples/statistics-reference.json` 使用同一版本参考数据。绝对/相对误差分别比较，普通有限统计量默认绝对误差 `1e-10` 或相对误差 `1e-8`；极小 p 另用相对误差或对数尺度核对，不能用宽绝对容差接受错误的 0。人数、状态、检验族、缺失和纳入集合须完全一致。

| 用例 | 必须验证的结果 |
| --- | --- |
| `[0]` | n=1、mean=0、SD=null、Q1=Q3=0；0 不丢失 |
| `[1,2,3,4]` | mean=2.5、SD=`sqrt(5/3)`、Q1=1.75、median=2.5、Q3=3.25 |
| `[1,2,3,4,100]` | Q1=2、Q3=4、上下须=1/4、100 单独显示但不删除 |
| A=`[1,2,3]`，B=`[2,4,4]` | n=3；a-b 的 t=-4、df=2；F=16、df=(1,2)、epsilon=1；二者原始 p 均为 `1-4/sqrt(18)`；单指标 M=2，二者 Holm p 均为其两倍 |
| 三个及以上样品的正常矩阵 | ANOVA、GG、偏 eta 平方、所有配对及 Holm 与锁定版本成熟库核对 |
| 某人缺一个样品的某指标 | 仅从该指标全部推断中排除；其他指标不受影响；逐样品概况 n 可不同 |
| 退回、重提、撤销和停用 | 纳入遵守 04，旧修订不回流，data_revision 改变且旧结果过时 |
| 恒定差值、全常数、重复单元格、非法分数 | 返回对应原因，不能产生假 p 或静默平均 |
| 多指标中一个不可计算、另有 ordinal | interval 计划检验保留 Holm 占位；ordinal 不计入 M；前后端结果与导出一致 |
| 某人 `[6,7,8]`，其他两人均为 `[1,2,3]` | 该人的留一参考为 `[1,2,3]`、平均偏差=5、RMSE=5、r=1；仍不判定绝对一致，不排名或剔除；推断退化不阻止复核结果 |
| 两样品，或个人/留一参考轮廓为常数 | 两样品的 r=null 且原因为 `INSUFFICIENT_PROFILE_POINTS`；至少三样品但任一轮廓恒定时为 `CONSTANT_PROFILE`；其他可算复核值保留 |
| 近常数轮廓及输出检查 | r=null、`NUMERICAL_FAILURE`；诊断无 p 值、不改变 Holm 的 M；稳定代号与现有 user_id 映射一致，无新增业务 ID |
| 服务不可用及重试 | 不切换数据源、不输出成功结果；相同幂等请求不新建重复任务 |

## 8. 后续扩展与来源

V1 不实现 Friedman/置换、Wilcoxon、混合模型、ICC、Tukey 或字母分组。后续若支持有序评分，须另立完整方法 ID、假设、并列秩、缺失、置换精度及多重比较契约；不能用方法名占位。若要估计重测重复性，先增加有设计依据的重复评分轮次及数据模型，再选择分析方法。

以下为官方文档；公式与 API 实现须锁定实际采用的软件版本，不能假定网页更新即改变已生成结果。

- <a id="stat1"></a>**STAT1**：[NIST，Randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm)。区组与处理效应模型。
- <a id="stat2"></a>**STAT2**：[Pingouin，rm_anova](https://pingouin-stats.org/generated/pingouin.rm_anova.html)。重复测量、GG 与完整案例处理。
- <a id="stat3"></a>**STAT3**：[R，quantile](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html)。type 7 分位数定义。
- <a id="stat4"></a>**STAT4**：[Pingouin，epsilon](https://pingouin-stats.org/generated/pingouin.epsilon.html)。GG epsilon 公式及范围。
- <a id="stat5"></a>**STAT5**：[statsmodels，AnovaRM](https://www.statsmodels.org/stable/generated/statsmodels.stats.anova.AnovaRM.html)。当前平衡设计与球形性校正限制。
- <a id="stat6"></a>**STAT6**：[SciPy，ttest_rel](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html)。相关样本 t 检验及区间。
- <a id="stat7"></a>**STAT7**：[R，p.adjust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html)。Holm 与家族错误率。
- <a id="stat8"></a>**STAT8**：[emmeans，Compact letter displays](https://rvlenth.github.io/emmeans/reference/CLD.emmGrid.html)。不显著不等于等效。
- <a id="stat9"></a>**STAT9**：[SciPy，pearsonr](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html)。常数、近常数和两点相关的边界。
