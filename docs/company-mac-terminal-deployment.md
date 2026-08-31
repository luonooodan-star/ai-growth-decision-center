# 公司 Mac 主服务器部署

本项目沿用“广告半自动上传工具”的运维模式：

```text
开发 Mac -> GitHub -> 公司 Mac -> npm 生产构建 -> launchd 常驻
                                      |
                                      +-> 局域网只读 Doris MCP
```

两个项目仍是独立仓库、独立进程和独立页面，不合并代码。AI
决策中心固定使用 `8081` 端口。公司 Mac 不需要安装 ChatGPT、Codex
或 `gh`。

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

要求 Node.js 22+ 和 `lark-cli`。没有 `lark-cli` 时先执行：

```bash
npm install -g --prefix "$HOME/.local" @larksuite/cli
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zprofile"
source "$HOME/.zprofile"
```

然后执行：

```bash
cd "$HOME/Downloads/work/ai-growth-decision-center"
zsh scripts/company-mac/setup.sh
```

脚本会依次：

1. 安装锁定依赖。
2. 完成一次飞书妙搭授权并拉取运行环境。
3. 把 `dmcp_...` Key 存入 macOS Keychain。
4. 直接调用 Doris MCP `whoami` 校验只读连接。
5. 执行类型检查和生产构建。
6. 安装 `launchd` 服务并开机自启。

部署后本机访问：

```text
http://localhost:8081/app/app_17cyvrepg1x/
```

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
不会覆盖。代码、Skill 和产品标准都通过 Git 更新；`.env.local`、
Doris Key 和日志只留在公司 Mac。

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
- 定时扫描只能写入“待判断异常”，不能直接调整广告。
- 判断的确认/待定/否决与调整建议的采纳率分开计算。
