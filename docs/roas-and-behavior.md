# ROAS 与优化师行为报表

顶部导航“ROAS数据查看”进入 `/roas`；分析中心的“优化师 / 渠道行为漏斗”进入 `/analysis/behavior`。

两页选择 Mellow Android / iOS 和最多 31 天的日期范围后，点击查询。人员和渠道在已加载结果内筛选，可导出 CSV。查询期间保留原结果，不在页面加载或筛选切换时自动抓取。

ROAS 使用 `ads_paid_acquisition_daily.spend` 与相同产品、优化师、原始媒体渠道、安装日期的 `ads_paid_acquisition_cohort_metric.cumulative_metric_value` 对齐，收入筛选 revenue、D、0—14。缺失收入不补零，正消耗记录才展示。观察未完成标 *；累计收入回落标 ↓。媒体消耗时区检查 Asia/Shanghai；收入表时区未独立核实，页面提示。汇总 ROAS 按总收入 / 总消耗计算；任一记录缺失该日收入时不输出汇总百分比。

行为复用现有分析任务：按首开去重用户关联 D0 当日事件与订单。单角色聊天深度沿用现有 ≥5、≥20 口径。优化师通过 daily 表的 campaign_id 或精确 campaign_name 映射，冲突、缺失单列，禁止根据名称中的人员字符串猜测。逐用户 ID 留在服务端。报表缓存升级到 v3，避免把旧的无人员归属报表当作新报表使用。

新 ROAS 接口使用当前用户的 Doris 权限和个人缓存命名空间，不新增跨用户授权。行为报表沿用既有 Mellow 共享授权契约。设计只读角色仍受前后端页面/API 白名单限制。所有 Doris 请求复用现有完整性校验、受限并发和重复请求合并。
