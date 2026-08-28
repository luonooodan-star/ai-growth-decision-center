# AI 增长决策中心

面向 Facebook 广告投放的增长分析与决策闭环工具。当前 MVP 已覆盖：

- 产品配置与 Doris 数据源标识
- 异常、原因、建议的结构化写入
- Campaign / Ad Set / Audience / Ad / Creative 全层级追踪
- 人工采纳、拒绝与原因记录
- 实验观察窗口和结果分类
- KR 工作台与实验统计
- 每小时扫描、每周一复盘的自动化 Handler 和停用态触发器
- 可供 Doris MCP 或外部 Agent 调用的 OpenAPI
- 可版本化的 Facebook 增长决策 Skill

## 技术结构

```text
Doris MCP / 外部 Agent
        ↓ OpenAPI
NestJS 服务 → PostgreSQL / Drizzle
        ↓
React 决策工作台
        ↓
人工采纳 / 拒绝 → 实验观察 → 结果复盘 → Skill 迭代
```

前端位于 `client/`，后端位于 `server/`，共享接口类型位于
`shared/api.interface.ts`。数据库建表脚本位于
`server/database/001_growth_decision.sql`。

## 本地启动

要求 Node.js 22 或更高版本，并已完成 `lark-cli` 用户授权。

```bash
npm install
npm run dev:local
```

当前本机开发地址由 `.env.local` 控制。本项目在开发机上使用：

```text
http://localhost:8081/app/app_17cyvrepg1x/
```

常用检查：

```bash
npm run type:check
npm run eslint
npm run build:prod
```

## Doris MCP 接入

运行时应用不直接调用 MCP。建议由 Codex、数据任务或现有调度器每小时：

1. 通过 Doris MCP 拉取 FB 前端和产品后台数据。
2. 完成数据成熟度检查、异常检测、第一波原因分析和初步判断。
3. 写入判断队列，人工选择“确认 / 待定 / 否决”并记录原因。
4. 仅对已确认判断生成独立调整建议，再进入采纳与实验闭环。

异常判断和调整建议是两类独立记录。判断结果用于迭代 Skill，但不进入
建议采纳率的分子或分母。

### 创建产品

`POST /openapi/growth-decision/products`

```json
{
  "name": "Product A",
  "targetMetric": "cpa",
  "channel": "facebook",
  "accountIds": ["act_123456", "act_789012"],
  "dorisSource": "bi_ads.ads_paid_acquisition_daily",
  "dataDelayMinutes": 60
}
```

### 写入异常和建议

`POST /openapi/growth-decision/cases`

```json
{
  "productId": "产品 UUID",
  "anomalyType": "CPA 突然上升",
  "severity": "high",
  "channel": "facebook",
  "campaignId": "238512345678",
  "campaignName": "US_iOS_Prospecting",
  "adsetId": "238512345679",
  "audienceId": "aud_us_broad",
  "adId": "238512345680",
  "creativeId": "creative_07",
  "targetMetric": "cpa",
  "currentValue": 42.8,
  "baselineValue": 31.2,
  "deviationPct": 37.2,
  "evidence": "过去 3 小时消耗 560 美元，转化 14 个，CPA 较七日同时段上升 37.2%。",
  "rootCause": "CTR 连续三天下降且 Frequency 升至 4.9，素材疲劳概率较高。",
  "confidence": 78,
  "recommendation": "暂停疲劳素材并启用两条新 UGC 素材，预算暂不调整。",
  "recommendedAction": {
    "actionType": "rotate_creative",
    "targetLevel": "ad",
    "targetId": "238512345680"
  },
  "expectedImpact": "72 小时内 CPA 下降至少 10%，转化量下降不超过 15%。",
  "riskNote": "若 24 小时内转化量下降超过 15%，恢复原素材。"
}
```

完整请求和响应定义见 `docs/openapi.json`。

## 自动化状态

已经创建两个妙搭触发器，并与代码 Handler 同名绑定：

- `hourlyGrowthScan`：每小时整点运行
- `weeklyGrowthReview`：每周一 10:00（Asia/Shanghai）运行

两者当前保持 `disabled`。这是刻意的安全门禁：只有代码发布并完成线上验证后，
再由管理员显式启用。

## 消息与广告执行集成

当前版本已完成决策记录和审批状态接口。下一阶段可在服务端增加适配器：

- 飞书 App：发送建议卡片、接收采纳/拒绝操作
- 钉钉机器人：发送群组或个人异常提醒
- 现有广告上传网页：接收已审批的结构化 `recommendedAction`

接入时应把密钥保存在妙搭环境变量中，不提交到 Git。广告执行默认保持人工确认，
并保存执行前后参数快照。

## Skill

通用分析 Skill 位于 `skills/fb-growth-decision/`。每个产品应基于
`references/product-profile-template.md` 建立独立知识包，而不是复制整个 Skill。

周复盘产生的单次结论先进入 `candidate_lessons`；只有重复验证或人工批准后，
才能升级为 `validated_rules` 并提升 Skill 版本。

## Git 与迁移

妙搭使用 `sprint/default` 作为开发分支。迁移到 GitHub 时建议保留妙搭远端，
额外添加一个 `github` 远端：

```bash
git remote add github <你的 GitHub 仓库地址>
git push -u github sprint/default
```

`.env.local`、日志、构建产物和依赖目录均已忽略，不会上传密钥或本机环境信息。
