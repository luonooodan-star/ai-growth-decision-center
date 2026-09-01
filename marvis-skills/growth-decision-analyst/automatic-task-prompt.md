请使用 `growth-decision-analyst` Skill，处理 AI 增长决策中心中一个等待 Marvis 分析的整批异常任务。

按 Skill 要求运行 `$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs claim`。如果没有等待任务，静默结束。领取成功后读取 `judgments` 中的完整异常上下文，按产品指标库、产品 Skill、数据延迟、消耗和样本量逐条完成深度判断；必要时可调用已连接的 Doris MCP 做只读补充核查。整批结果必须覆盖每个 judgmentId，再通过 `marvis-worker.mjs submit-batch` 一次回写，由决策中心拆分到对应异常。禁止读取或显示 Keychain 凭据，禁止直接修改任何广告预算、状态、出价、受众、素材或投放结构。

执行频率：每 30 分钟一次（Marvis 自动任务的最低间隔）。只有网页端明确创建整批分析任务后才会进入队列；需要立即分析时，在 Marvis 中手动点击一次“运行”。每次领取一个整批任务并完整处理。
