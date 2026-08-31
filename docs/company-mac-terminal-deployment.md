# 公司 Mac 终端部署

本方案让 AI 增长决策中心与广告半自动上传工具独立运行：

- 广告半自动上传工具继续使用原端口。
- AI 增长决策中心使用 `8081`。
- Doris MCP 使用 `8766`，Superset MCP 使用 `8767`。
- 两个 MCP 共用同一个 `dmcp_...` Key。
- Key 保存在 macOS Keychain，不进入 Git、`.env` 或 shell 历史。
- 项目级 Codex 配置只允许 Doris 和 Superset 的只读工具。

## 首次安装

在公司 Mac 的终端执行：

```bash
mkdir -p "$HOME/Projects"
cd "$HOME/Projects"
git clone --branch sprint/default \
  https://github.com/luonooodan-star/ai-growth-decision-center.git
cd ai-growth-decision-center
zsh scripts/company-mac/setup.sh
```

私有仓库首次克隆时，需要在终端完成 GitHub 登录。脚本还会检查：

- Node.js 22+
- npm
- `lark-cli`
- Codex CLI

缺少终端工具时，可先安装：

```bash
npm install -g @openai/codex
npm install -g --prefix "$HOME/.local" @larksuite/cli
export PATH="$HOME/.local/bin:$PATH"
```

脚本运行过程中需要完成一次飞书授权，并在终端安全输入 Doris/Superset
API Key。输入内容不会显示，也不会写入仓库。

## 验证 MCP

```bash
cd "$HOME/Projects/ai-growth-decision-center"
scripts/company-mac/codex-growth mcp list
scripts/company-mac/codex-growth exec --sandbox read-only \
  "只调用 Doris whoami 和 Superset whoami，确认当前用户、角色和只读能力。不要创建或修改任何内容。"
```

预期身份为 `lzx`，Doris 角色为 `paid_manager`。Superset 即使服务端账号拥有写
能力，项目配置也不会向 Codex 暴露写工具。

## 访问与维护

浏览器访问：

```text
http://localhost:8081/app/app_17cyvrepg1x/
```

查看服务状态：

```bash
launchctl print gui/$(id -u)/com.luonooodan.ai-growth-decision-center
```

查看日志：

```bash
tail -f "$HOME/Library/Logs/ai-growth-decision-center/service.log"
tail -f "$HOME/Library/Logs/ai-growth-decision-center/service-error.log"
```

更新版本：

```bash
cd "$HOME/Projects/ai-growth-decision-center"
git pull --rebase origin sprint/default
npm ci
launchctl kickstart -k \
  gui/$(id -u)/com.luonooodan.ai-growth-decision-center
```

当前只完成 MCP 只读接入和网页常驻运行。每小时自动分析仍保持停用，需在目标 Mac
完成一次 `whoami` 与 Wingslite 查询验证，并补充去重策略后再启用，避免重复生成异常判断。
