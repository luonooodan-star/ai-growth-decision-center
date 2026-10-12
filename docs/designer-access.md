# 设计同学只读账号

`designer` 角色仅开放「投放数据」和「授权与连接」中的本人 Doris 配置。导航、直接页面访问和后端接口分别限制；Meta 授权/状态/操作、分析中心、产品中心、指标管理、Skill 和复盘接口均拒绝，包含 OpenAPI / MCP 入口。允许下载页面 CSV、看数据趋势及 Doris 系列明细，数据行范围仍由本人 Doris Key 决定，不使用 growth 的高权限 Key 或定向共享缓存。

设计角色对应 Doris creative 权限：投放查询只访问 `bi_ads.ads_paid_acquisition_daily`，请求消耗、展示、点击、媒体安装、归因安装；CPI、CTR、CPM 等比例由允许的指标计算。服务端跳过 cohort 收入表（包括旧收入缓存），页面概览、明细、CSV、趋势和系列详情不提供收入、D0 ROAS 或收入事件，不展示达标筛选。无收入权限是预期状态，不显示为抓取故障。个人 `producer_alias` 行级约束仍由 Doris Key 强制执行，不在客户端代替权限过滤。

设计账号不会发起 Meta 状态轮询、Meta 信息读取或决策后台定时抓取。投放数据页的产品同步（会创建决策产品）和决策入口隐藏，后端也禁止；产品目录由管理同学维护。

部署新版后，在公司 Mac 原仓库目录创建这次的两个账号：

```sh
cd /Users/toufanga/Services/ai-growth-decision-center
node scripts/company-mac/add-center-user.mjs zxy --role designer
node scripts/company-mac/add-center-user.mjs cz --role designer
```

分别交互输入各自密码（12～1024 位、不回显），仅保存加盐哈希到 Git 忽略的 runtime/center-users.json。脚本不覆盖已存在的账号。账号创建/角色变更会使旧登录会话失效，需要重新登录，不需要再重启服务。两人登录后仅配置自己的 Doris Key 即可查询，不需要 Meta 桥接。

已有账号调整角色，密码不变：

```sh
node scripts/company-mac/add-center-user.mjs zxy --set-role --role designer
```

旧账号未填写 role 时保持 operator（现有功能不变）。无效角色拒绝访问。角色不等于 Doris 行级授权；如果只允许设计同学看自己素材，须由数据管理员发放相应受限 Key。
