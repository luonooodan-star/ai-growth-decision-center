---
name: growth-decision-analyst
description: 领取 AI 增长决策中心的广告异常任务，结合产品指标标准和 Doris/Facebook 证据完成第一波异常判断并回写。用于 Marvis 自动任务或用户要求处理增长异常；不执行广告调整。
---

# 增长异常判断

通过本机安全代理调用 `ai-growth-decision-center` MCP，处理一个等待中的异常任务。代理位于 `$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs`，只从 macOS Keychain 读取认证信息，不得要求用户把密码或 Token 写进提示词。判断与调整建议是两个阶段：本 Skill 只完成异常是否成立、初步原因和下一步核查建议，不把判断结果计入建议采纳率。

## 工作流

1. 用 shell 执行 `node "$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs" claim`。该命令会依次调用 `claim_analysis_job` 和 `get_anomaly_context`。若输出中的 `job` 为 `null`，静默结束，不生成空报告。
2. 从命令输出读取任务对应的产品、异常、指标库标准、数据更新时间和产品 Skill 版本。不要再次领取任务。
3. 先验证数据口径，再判断异常：
   - 当前值是否真的越过指标库上下边界；
   - 数据是否覆盖完整观察窗口，是否仍在 Doris/归因延迟期；
   - Campaign、广告组、国家、素材等维度是否能支持该判断；
   - 消耗和样本量是否足够，避免把小样本波动当成异常；
   - 能使用 Doris MCP 时，只补拉完成判断所必需的数据，不扩大到无关产品或账户。
4. 输出三态判断：
   - `confirmed`：现有证据足以确认异常现象成立；
   - `uncertain`：疑似异常，但延迟、样本量或维度证据不足；
   - `rejected`：口径、时间窗或补充数据表明异常不成立。
5. 把以下结构化结果写到 `$HOME/Downloads/ai-growth-marvis/analysis-<jobId>.json`：
   - `judgment`
   - `summary`
   - `primaryCause`
   - `evidence`（字符串数组，写清数值、基准、时间窗和维度）
   - `alternativeCauses`（字符串数组）
   - `recommendedNextStep`
   - `risk`
   - `confidence`（0–100）
   - `observationHours`（1–168）
6. 执行 `node "$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs" submit <jobId> <analysis.json路径>`。该命令通过 `submit_anomaly_analysis` 回写结果。只有看到成功响应后才算完成。
7. 如果已经领取任务但无法完成，执行 `node "$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs" fail <jobId> <错误原因>`，禁止让任务永久停在运行中。

## 判断边界

- 全程只读。不得调整预算、启停广告、修改出价、受众、素材或投放结构。
- 指标库阈值用于确认异常现象，不足以单独证明根因。根因必须区分“已验证”和“可能相关”。
- 优先使用产品指标库和该产品 Skill；不得把其他产品的阈值套用到当前产品。
- 数据延迟期间优先返回 `uncertain` 并给出建议观察小时数，不强行确认。
- `recommendedNextStep` 是核查/诊断动作，不是预算或状态调整指令。
- 每次只处理一个任务，让下一分钟的自动任务继续领取，避免一次运行失控。
- 不得读取、显示或复制 Keychain 中的访问密码与 Marvis Token。
