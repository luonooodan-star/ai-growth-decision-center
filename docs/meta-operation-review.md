# Meta 操作与 Doris 复盘

入口 `/operations`。Meta 只读，所有广告修改仍由优化师在 Meta 完成。

## 接线

- Token 保护的 MCP 新工具 `import_meta_operations`，输入合同 `shared/meta-operations.ts`。
- Codex 文件凭据桥新增 `import-meta` 命令，不复制或暴露凭据。更新后须重启本机桥进程（现有 configure-codex-worker.sh 安装流程）。
- 自动任务前置步骤见 `scripts/company-mac/meta-sync-task-prompt.md`。公司 Mac 未部署此工具时跳过，不能假装同步成功。
- 操作流水保存在独立 SQLite 表，不放入可淘汰 BI 缓存。请求最多 500 条，整批校验后写入、幂等重试。
- `accountId + campaignId` 精确关联且产品唯一后才建立实验；未匹配记录留在复盘页，后续 Doris 抓取再次关联。不按广告系列名称猜测。
- 已有实验库会显示自动建立的“已执行加量/减量/调整”观察。新的系列操作结束上一段观察，保留历史，结束 7 天后按现有实验库逻辑隐藏。
- 每次 Doris 抓取保存系列日累计快照，不依赖是否配置异常阈值；不是小时新增数据。

## 数据口径与边界

操作时间必须为带时区 ISO，raw 保存原始日志用于审计。normalizer 将账户时间转换 UTC，Doris 对照目前按项目现有 Asia/Shanghai 日界（上线前应核对数据源 timezone 字段），调整当日不参与前后对照。夏令时歧义拒绝导入。

操作前近 3 个日历日、操作后 7 日内已结束日展示逐日 D0，不平均 ROAS；没有完整数据、样本不足、同期多操作时不宣称因果或有效。预算保留日志原始单位，页面不把原始 payment_amount 冒充美元。

广告组/广告操作只能观察系列 D0，当前 cohort 数据集无广告组维度。未知操作保留审计但不自动分类。新建初始化和系统事件不当作预算调整实验。

系列目标、广告组优化目标、具体转化事件分别保存。具体事件不支持时显示未返回。当前 metadata 表保存最近抓取值，用于当前列表筛选，不用它反推历史配置；历史配置以操作流水原始证据为准。

当前通过 Codex + Meta MCP 周期采集，不是公司 Mac 直接拥有 Meta 连接。保持分析电脑在线、Meta 授权可用以及公司网络可达；故障应报告，不能跳过缺口并宣称全量。

## 验证

覆盖去重、长 ID、时区、新建/系统事件、缺少归属、Doris 到达后重关联、前后日期排除、并发操作干扰、元数据版本顺序、后续操作结束旧观察。运行 `npm test -- --runInBand`、`npm run type:check` 和 `npm run build:company`。
