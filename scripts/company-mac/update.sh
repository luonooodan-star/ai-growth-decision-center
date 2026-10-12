#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"
cd "$project_dir"
if [[ -n "$(git status --porcelain)" ]]; then
  print -u2 "检测到未提交修改，已停止更新。"
  exit 1
fi
readonly DEPLOY_REMOTE="${DEPLOY_REMOTE:-https://github.com/luonooodan-star/ai-growth-decision-center.git}"
git fetch "$DEPLOY_REMOTE" sprint/default
git merge --ff-only FETCH_HEAD
node scripts/company-mac/deploy-release.mjs
