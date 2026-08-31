# 公司 Mac 主服务器部署

本项目沿用“广告半自动上传工具”的运维模式：

```text
开发 Mac -> GitHub -> 公司 Mac -> npm 生产构建 -> launchd 常驻
                                      |
                                      +-> 局域网只读 Doris MCP
```

两个项目仍是独立仓库、独立进程和独立页面，不合并代码。AI
决策中心固定使用 `8081` 端口。公司 Mac 不需要安装 ChatGPT、Codex、
`gh`、`lark-cli`，也不需要授权妙搭 `apps` 权限。

## 1. GitHub 权限（只做一次）

由于仓库是私有的，公司 Mac 必须拥有读取权限。`gh: command not
found` 不是项目故障，不需要安装 `gh`。

在 GitHub 创建 fine-grained personal access token，仅选中
`ai-growth-decision-center` 仓库，权限只给 `Contents: Read-only`。然后在
公司 Mac 终端执行：

```bash
git config --global credential.helper osxkeychain
mkdir -p "$HOME/Downloads/work"
cd "$HOME/Downloads/work"
git clone --branch sprint/default \
  https://github.com/luonooodan-star/ai-growth-decision-center.git
```

Git 询问时：

- Username：输入 GitHub 用户名。
- Password：粘贴 token，不是 GitHub 登录密码。

token 会交给 macOS 凭据钥匙保存，不会写入仓库。如果仍然出现
`403`，先在“钥匙访问”里删除 `github.com` 的旧 Internet password，再重试
clone，避免 Git 继续使用另一个无权限账号。

## 2. 首次部署

要求 Node.js 22.13 或更高版本。无需配置飞书或妙搭 CLI。

然后执行：

```bash
cd "$HOME/Downloads/work/ai-growth-decision-center"
zsh scripts/company-mac/setup.sh
```

脚本会依次：

1. 安装锁定依赖。
2. 设置独立的页面访问密码，并存入 macOS Keychain。
3. 把 `dmcp_...` Key 存入 macOS Keychain。
4. 直接调用 Doris MCP `whoami` 校验只读连接。
5. 执行类型检查和生产构建。
6. 创建本地 SQLite 数据库，安装 `launchd` 服务并开机自启。

首次部署完成后，可查看供 Marvis 使用的 MCP 地址和 Token：

```bash
zsh scripts/company-mac/configure-mavis.sh
```

MCP Token 由部署脚本自动生成并单独保存在 macOS Keychain。当前第一版
默认使用产品 Skill 模拟 Marvis Worker，先验证“创建任务 → 读取上下文 →
结构化分析 → 回写页面”的完整闭环，不需要任何第三方模型 API Key。
MCP 客户端需同时使用页面 HTTP Basic 登录，并通过独立的
`X-Marvis-Token` 请求头传入 Marvis Token（旧的 `X-Mavis-Token` 仍兼容）。

接入真实 Marvis Worker 后切换模式：

```bash
zsh scripts/company-mac/configure-mavis.sh external
```

### 双 Mac 部署：公司 Mac 托管，另一台 Mac 运行 Marvis

公司 Mac 不需要安装 Marvis，只运行网页、Doris 抓取、SQLite 和分析任务队列。
先在公司 Mac 查看局域网 MCP 地址与 Token，并切到外部 Worker 模式：

```bash
zsh scripts/company-mac/configure-mavis.sh status
zsh scripts/company-mac/configure-mavis.sh external
```

在能运行 Marvis 的分析 Mac 上生成 Skill、自动任务提示词和安全代理：

```bash
zsh scripts/company-mac/prepare-marvis-integration.sh
```

脚本会把接入包生成到 `~/Downloads/ai-growth-marvis/`。然后在分析 Mac 执行：

```bash
zsh "$HOME/Downloads/ai-growth-marvis/configure-marvis-remote.sh" setup
```

按提示输入公司 Mac 的局域网页面地址、页面访问密码和 `X-Marvis-Token`。
安全代理只把认证信息存入分析 Mac 的 Keychain，不会写入 Skill 或提示词；配置完成会自动执行无副作用连接检查。
在 Marvis 中导入生成的 `growth-decision-analyst.zip`，再创建每 1 分钟运行一次的
自动任务并粘贴生成的提示词。网页点击“使用 Marvis 分析”后，任务会先进入本地队列，
分析 Mac 上的 Marvis 在下一次轮询中通过局域网领取、分析并回写，通常等待不超过 1 分钟。
两台 Mac 必须能互相访问公司 Mac 的 8081 端口；跨网络使用时应通过公司 VPN，不把该端口直接暴露到公网。当前 Marvis 桌面版
没有公开的外部对话唤醒接口，因此不使用易失效的界面模拟点击方案。

如果需要恢复内置闭环测试模式：

```bash
zsh scripts/company-mac/configure-mavis.sh simulation
```

部署后本机访问：

```text
http://localhost:8081/
```

浏览器首次访问会要求 HTTP Basic Auth：

- 用户名：`growth`
- 密码：首次部署时设置的访问密码

局域网其他电脑访问时，把 `localhost` 换成公司 Mac 的局域网 IP。

## 3. 日常推送与更新

开发 Mac 上只推送已验证代码：

```bash
git push github sprint/default
```

公司 Mac 上只执行：

```bash
cd "$HOME/Downloads/work/ai-growth-decision-center"
zsh scripts/company-mac/update.sh
```

`update.sh` 仅允许 fast-forward，如果服务器上有未提交代码会立即停止，
不会覆盖。代码、Skill 和产品标准都通过 Git 更新；SQLite
数据库、Doris Key 和日志只留在公司 Mac。

业务数据位于：

```text
$HOME/Downloads/work/ai-growth-decision-center/runtime/ai-growth.sqlite
```

代码更新不会删除或覆盖该文件。请将 `runtime/` 加入公司 Mac 的定期备份。

## 4. 运维检查

```bash
launchctl print \
  gui/$(id -u)/com.luonooodan.ai-growth-decision-center

tail -f \
  "$HOME/Library/Logs/ai-growth-decision-center/service-error.log"

cd "$HOME/Downloads/work/ai-growth-decision-center"
node scripts/company-mac/mcp-whoami.mjs
```

Doris MCP 是 `192.168.3.102` 局域网地址，公司 Mac 必须在对应公司网络
或 VPN 中。Cloudflare/Sites 等公网托管不能直接访问该私网地址。

## 5. 安全边界

- Doris 仅开放 `whoami` / `list_datasets` / `list_metrics` /
  `query_metric` / `resolve_entity` 等只读能力。
- Superset 暂不参与自动修改，即使账号存在写权限，也不使用。
- 页面与所有 API 均受独立访问密码保护，并拒绝跨站写入。
- 定时扫描只能写入“待判断异常”，不能直接调整广告。
- 判断的确认/待定/否决与调整建议的采纳率分开计算。
- Marvis MCP 只开放异常任务领取、上下文读取、结构化分析回写和失败记录，
  不开放 Shell、文件删除、Doris 凭据或广告账户写操作。
