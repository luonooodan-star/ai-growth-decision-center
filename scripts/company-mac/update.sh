#!/bin/zsh
set -euo pipefail

readonly DEPLOY_BRANCH="sprint/default"
readonly DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

cd "$project_dir"

if ! git diff --quiet || ! git diff --cached --quiet; then
  print -u2 "检测到本地代码修改，已停止更新，避免覆盖。"
  exit 1
fi

print "[1/6] 拉取 GitHub $DEPLOY_BRANCH"
git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
git merge --ff-only FETCH_HEAD

print "[2/6] 初始化 Marvis 本地凭据"
zsh scripts/company-mac/configure-mavis.sh ensure

print "[3/6] 安装锁定依赖"
npm ci

print "[4/6] 验证 Doris 只读连接"
node scripts/company-mac/mcp-whoami.mjs

print "[5/6] 校验并构建"
npm run type:check
npm run build:company

print "[6/6] 重启公司 Mac 服务"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL"

lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
print "更新完成：http://localhost:8081/"
[[ -n "$lan_ip" ]] && print "局域网页面：http://$lan_ip:8081/"
