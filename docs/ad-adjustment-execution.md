# 行内广告调整

## 页面行为

- `/adjustments` 进入时只加载产品和渠道选项，不抓取经营数据。选择明确产品和渠道后点击“抓取数据”；不再按筛选变更、旧缓存时间或定时器自动抓取。
- 展开系列 → 广告组 → 素材，点击“启停 / 预算调整”读取 Meta 当前配置。素材会核对所属广告组并映射成真实广告；同素材对应多个广告时分别展示、分别选择，不按名字猜 ID。
- 复选后可对多个对象填写状态及日预算。父页面持有草稿并保存到本机 localStorage，折叠、筛选不会丢失。草稿只保存 ID、名称、状态及预算，不保存 token。共享电脑的草稿可见，使用完应清理不需要的草稿。
- 底部“预检并提交”读取最新原值生成服务端确认清单，用户二次确认才执行。清单 10 分钟有效；执行前再次核对原值，外部修改引起的冲突会拒绝执行。
- 广告支持开启/暂停，无独立预算。系列统一预算时禁止改广告组预算；总预算不切换成日预算。当前只开放 USD 日预算，其他币种显示限制，不能按美元误修改。开启子级不自动开启上级。
- 后端逐项执行，任务进行中不允许另起修改任务。同一任务重复提交不会重放。写入前留档，完成后回读；网络不确定则停止后续任务，禁止自动重试。服务重启不重放运行中任务，改为中断并提示人工核对。
- 所有确认清单、操作人 Meta ID、提交时间、修改前后值、错误及进度存入原决策中心 SQLite 的 `growth_adjustment_job`。不自动清除；页面当前显示最近 100 个当前 Meta 用户的任务。进度轮询只在存在运行中任务时开启，与 Doris 数据抓取无关。

## 部署（两端都需要）

**公司 Mac 推荐使用新的 [本机桥方案](meta-local-bridge.md)**：决策中心保留 8081，不需要下方的 HTTPS/跨端口 Cookie 配置。下方为旧 HTTPS 模式，保留兼容。

不再嵌入上传工具页面，但仍使用它已有的 Meta 会话及 Graph 客户端。新适配路由单独安装，不改动原 `lib/meta.ts`、上传 API、任务队列、OAuth 回调或 key。

在公司 Mac 决策中心仓库执行：

```sh
node scripts/company-mac/install-adjustment-adapter.mjs /原广告工具仓库的绝对路径
```

安装器仅增加 `app/api/meta/growth-adjustments/route.ts` 和 `lib/growth-adjustment-contract.ts`，覆盖前留 `.bak`。在原广告工具仓库按原构建与服务管理流程重建/重启。然后构建并重启决策中心。

决策中心仍需配置 `GROWTH_META_WORKSPACE_ORIGIN` 指向原服务，并使用**同主机名 HTTPS**，详见 [HTTPS 配置](meta-execution-workspace.md)。首次在原工具正常登录，再回到决策中心；沿用原 HttpOnly Secure Cookie，不复制或显示 key。HTTP 8081 不能接收 Secure 会话 Cookie，不能用于广告修改。

未配置地址、未安装适配接口、登录失效或证书不受信任时明确报错，不能显示伪成功。安装和配置工具不会自动修改任何广告。

## 验收边界

自动测试使用隔离数据库和模拟 Graph 响应，不连接真实 Meta 或执行真实广告修改。公司环境实际登录、读取对象和修改结果需部署后验证；真实修改须由优化师核对清单并确认。

接口合同核对参考 Meta 官方 [Campaign 更新示例](https://www.postman.com/meta/facebook-marketing-api/request/mjscwl2/updating-campaign-details-l3) 和 [Ad SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py)。
