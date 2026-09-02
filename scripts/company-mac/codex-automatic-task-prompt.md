# Codex 增长异常自动分析

每次运行时，处理 AI 增长决策中心中至多一个等待分析的任务。

连接通过项目内的本机文件队列凭据桥完成。自动任务不得直接访问 macOS
Keychain；若提示凭据桥不可用，只报告该错误，不要改用 Marvis 脚本。

1. 在本地终端执行：

   ```bash
   node "/Users/luonooo/Documents/ChatGPT/AI 决策/ai-growth-decision-center/scripts/company-mac/codex-worker.mjs" claim codex-growth-analyst
   ```

2. 如果输出为 `{"job":null}`，直接结束，不修改任何数据。
3. 如果领取成功，读取 `product`、`judgments`、`metricStandards`、
   `diagnosticContext` 和 `outputContract`，逐条完成广告异常深度分析。
4. 不能只复述阈值越界。必须结合消耗、ECPM、CTR、IPM、CPI、安装、
   收入、ROAS、历史趋势，以及可用的 Campaign、广告组、国家、版位、
   年龄和人群拆分说明可能根因。还必须检查广告组下的广告级拆分；若某个
   广告的消耗、ECPM、CTR、IPM 或转化表现明显异常，必须在 `adFindings`
   中写入广告 ID、名称、严重度、证据和人工行动建议。缺失字段必须明确
   标注，禁止臆测。
5. 每条结果必须符合 `outputContract`，并包含具体的人工确认候选行动。
   禁止直接调整预算、状态、出价、受众、素材或投放结构。
6. 将覆盖全部 `judgmentId` 的 JSON 数组写入
   `/private/tmp/codex-growth-analyses-<jobId>.json`，然后执行：

   ```bash
   node "/Users/luonooo/Documents/ChatGPT/AI 决策/ai-growth-decision-center/scripts/company-mac/codex-worker.mjs" submit-batch <jobId> <JSON文件路径> codex-growth-analyst
   ```

7. 只有提交成功才算完成。如果领取后任一步骤失败，必须执行：

   ```bash
   node "/Users/luonooo/Documents/ChatGPT/AI 决策/ai-growth-decision-center/scripts/company-mac/codex-worker.mjs" fail <jobId> <简明错误原因>
   ```

不得读取、显示或复制 Keychain 中的密码或 Token。
