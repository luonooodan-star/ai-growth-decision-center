#!/bin/zsh
set -euo pipefail

readonly GROQ_KEYCHAIN_SERVICE="ai-growth-decision-center-groq"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

print -n "请输入 Groq API Key（gsk_ 开头，输入不会显示）："
read -r -s groq_api_key
print

if [[ "$groq_api_key" != gsk_* ]]; then
  print -u2 "错误：Groq API Key 应以 gsk_ 开头。"
  exit 1
fi

security add-generic-password \
  -a "$USER" \
  -s "$GROQ_KEYCHAIN_SERVICE" \
  -w "$groq_api_key" \
  -U >/dev/null
unset groq_api_key

node "$project_dir/scripts/company-mac/groq-whoami.mjs"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || true

print "Groq 已配置，服务重启后可在异常队列点击“AI 深度分析”。"
