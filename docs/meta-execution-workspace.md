# 广告操作工作区接入

## 边界

广告调整页 `/adjustments` 内可展开原 Meta Creative Vault 工作区。原工具继续独立运行，作为唯一操作服务；不是把业务代码复制到决策中心，也不是新建一套任务队列。

本次只增加统一外层 UI、原工作区嵌入和可选 HTTPS 入口。原工具的 API、OAuth 回调、`meta_session` Cookie、加密 key、localStorage key、数据库、文件夹上传顺序、模板和任务执行流程不变。内部原工具 UI 原样保留。不自动代入当前数据筛选条件，不自动发布广告。

预算调整/启停并未因此新增；后续必须核对原服务已有接口并单独实现确认流程，不能把创建广告接口当成修改接口。

## 公司 Mac 配置（需部署时完成）

在决策中心的服务环境中添加以下非 Meta 凭据配置；不要复制 `.env.local` 的 Meta key：

```text
GROWTH_META_WORKSPACE_ORIGIN=https://192.168.3.173:3001
GROWTH_SECURE_CENTER_ORIGIN=https://192.168.3.173:8443
GROWTH_HTTPS_PORT=8443
GROWTH_TLS_CERT_PATH=/absolute/path/to/existing-trusted-certificate.crt
GROWTH_TLS_KEY_PATH=/absolute/path/to/existing-certificate-private.key
```

地址应使用公司实际原工具地址。证书路径指向现有受信任证书与匹配的私钥，不生成/轮换 Meta key，不修改原工具。证书必须覆盖入口主机名；证书不受信任时应修复证书信任，禁止跳过浏览器警告或关闭 TLS 校验。

这是额外监听入口，原 HTTP 8081 及自动任务保留。两个入口共用同一个应用实例、数据库和 Basic Auth 保护；不启动第二套数据抓取定时任务。只有部署时显式配置才开启 HTTPS，当前改动不会自动重启公司服务。

## 使用与验收

### 持久化配置（推荐）

在公司 Mac 的决策中心仓库目录中完成构建后执行（将证书路径替换为实际的绝对路径）：

```sh
npm run build:company
node scripts/company-mac/configure-meta-workspace.mjs setup \
  --workspace-origin https://192.168.3.173:3001 \
  --center-origin https://192.168.3.173:8443 \
  --cert /absolute/path/to/existing-trusted-certificate.crt \
  --key /absolute/path/to/existing-certificate-private.key
node scripts/company-mac/configure-meta-workspace.mjs check
```

配置保存到 Git 忽略的 `runtime/meta-workspace.json`，只保存地址、端口、证书路径，不保存证书内容或 Meta 凭据。覆盖前自动留下 `.bak` 备份。随后通过原服务管理方式重启决策中心；配置命令本身不会重启服务。现有公司 Mac 启动脚本会进入仓库目录，服务每次启动都会读取此文件，显式环境变量优先，但组合后仍须通过校验。

`check` 只检查本地配置、证书日期、入口主机名和私钥匹配，不代表原工具在线、浏览器信任或登录成功。不访问 Keychain，不请求 Meta API。浏览器联调仍按以下步骤完成。需要回滚时，将备份恢复为 `runtime/meta-workspace.json` 再重启；不删除原工具数据。

1. 在 HTTPS 决策中心打开广告调整页，展开「广告操作」。
2. 首次在原工具中正常登录，再点击「已登录，载入操作工作区」。OAuth 留在原地址，不通过 iframe 重新授权。
3. 在原工作区导航切换素材库、应用配置、广告模板、粉丝页、受众及发布任务。
4. 决策数据刷新、收起/展开操作区不会重新挂载 iframe。离开整个页面仍会离开上传界面，应等待上传完成。
5. 缺少配置、HTTP 入口或主机名不一致时显示明确原因，不加载会丢失登录状态的 iframe。
6. 页面载入事件不能证明远程服务成功或已登录；因此不显示虚假的「已连接」。原工具状态是权威状态。浏览器拦截 iframe 时保留原工具入口。

本地自动测试不连接 Meta，不上传素材或创建广告。正式 HTTPS、登录与原服务联调需在公司 Mac 部署后验证。
