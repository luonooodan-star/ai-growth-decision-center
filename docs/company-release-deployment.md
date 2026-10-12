# 公司 Mac：隔离构建与低优先级后台同步

## 更新方式

首次获取新版脚本：

```sh
cd /Users/toufanga/Services/ai-growth-decision-center
git pull --ff-only https://github.com/luonooodan-star/ai-growth-decision-center.git sprint/default
zsh scripts/company-mac/update.sh
```

以后在仓库运行 `zsh scripts/company-mac/update.sh` 即可。不要再用原目录 `npm ci` / `npm run build:company` 配合重启作为发布流程：启用发布目录后，服务不再读取根目录的 dist。

更新脚本只接受干净工作区，拉取 sprint/default 后将该提交归档到 `runtime/releases/<commit>-<timestamp>`。在那里独立安装锁定依赖、类型检查、单进程测试、发布回退测试和构建；降低构建进程优先级，不覆盖当前运行版本的 dist 或 node_modules。安装禁用项目云端初始化/prepare 钩子；依赖若不能在该模式构建，会在切换前失败。

构建、测试、静态资源完整性检查全部通过后，原子替换 `runtime/active-release.json` 并通过原 launchctl 标签重启。健康检查必须返回新版本 ID，避免把旧进程尚未退出误判为发布成功。失败恢复旧指针并再次重启/检查；回退失败会明确报错。旧版本目录保留，未自动删除。构建失败的候选目录也保留供排查，需定期人工清理已确认不再使用的版本以控制磁盘占用。

切换不是零停机，仍会短暂断开请求；构建虽降低 CPU 优先级，仍使用内存/磁盘，建议避开公司 Mac 高负载时段。`npm ci` 需要可访问 npm 源。

## 数据与权限不变

服务 cwd 始终为原仓库。SQLite、个人 Doris 凭据、Meta 桥凭据和配置仍使用原 `runtime`，不复制到发布目录。原 Keychain 读取和监听端口保持不变。健康检查只访问本机 HTTP 8081，不查询 Doris/Meta、不执行广告操作。首次部署没有发布指针时沿用根目录 dist。

上一版本指针备份在 `runtime/previous-release.json`。自动回退只切换代码，不回滚数据库；未来涉及不兼容数据库迁移时仍需单独制定回退方案。异常强杀更新进程可能留下空 `runtime/deploy.lock`；确认没有部署任务后再手动移除这个空目录，不删除 runtime。

仅验证候选构建，不切换或重启：`node scripts/company-mac/deploy-release.mjs --build-only`。

## 后台同步调度

- 取消启动后 60 秒强制同步。启动后首次检查为 5 分钟，此后每 5 分钟检查；产品数据有效期仍为 1 小时，不是每 5 分钟全量抓取。
- 自动同步只选择活跃且 lastSyncAt 缺失/无效/超过 1 小时的产品。用户 Doris 查询运行、排队或刚结束 30 秒内，暂缓新一轮后台同步，并在切换用户/产品时再次检查。
- Doris 总并发仍为 2，后台最多 1；交互查询优先排队，保留用户间轮转。后台排队最多 16，避免填满用户队列。已经发出的请求不会被强杀，因此不能保证后台完全零资源影响。
- 定时复盘观察仍保留，但采用相同后台优先级；单日观察现在真正尊重 historyDays=1，避免意外每次查询 8 天。
- 不放松完整性校验、个人凭据隔离或 Meta 写入预检；手动查询不会等待一个尚在排队的同口径后台请求。
