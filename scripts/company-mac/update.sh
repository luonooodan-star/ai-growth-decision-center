#!/bin/zsh
set -euo pipefail

readonly APP_ID="app_17cyvrepg1x"
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

print "[2/6] 安装锁定依赖"
npm ci

print "[3/6] 刷新妙搭运行环境"
lark-cli apps +env-pull --app-id "$APP_ID" --as user

print "[4/6] 验证 Doris 只读连接"
node scripts/company-mac/mcp-whoami.mjs

print "[5/6] 校验并构建"
npm run type:check
npm run build:prod

print "[6/6] 重启公司 Mac 服务"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL"

print "更新完成：http://localhost:8081/app/$APP_ID/"
