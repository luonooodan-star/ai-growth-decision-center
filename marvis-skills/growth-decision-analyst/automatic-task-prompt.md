请使用 `growth-decision-analyst` Skill，处理 AI 增长决策中心中一个等待 Marvis 分析的异常任务。

按 Skill 要求运行 `$HOME/Downloads/ai-growth-marvis/marvis-worker.mjs claim`。如果没有等待任务，静默结束。领取成功后读取完整异常上下文，按产品指标库、产品 Skill、数据延迟、消耗和样本量完成第一波异常判断；必要时可调用已连接的 Doris MCP 做只读补充核查。将结构化结果写入 JSON 文件，再通过 `marvis-worker.mjs submit` 回写。禁止读取或显示 Keychain 凭据，禁止修改任何广告预算、状态、出价、受众、素材或投放结构。

执行频率：每 30 分钟一次（Marvis 自动任务的最低间隔）。需要立即分析时，在 Marvis 中手动点击一次“运行”。每次只处理一个任务。
