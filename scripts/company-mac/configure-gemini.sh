#!/bin/zsh
set -euo pipefail

readonly GEMINI_KEYCHAIN_SERVICE="ai-growth-decision-center-gemini"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

print -n "请输入 Google AI Studio Gemini API Key（输入不会显示）："
read -r -s gemini_api_key
print
[[ -n "$gemini_api_key" ]] || {
  print -u2 "错误：Gemini API Key 不能为空。"
  exit 1
}

security add-generic-password \
  -a "$USER" \
  -s "$GEMINI_KEYCHAIN_SERVICE" \
  -w "$gemini_api_key" \
  -U >/dev/null
unset gemini_api_key

node "$project_dir/scripts/company-mac/gemini-whoami.mjs"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || true
print "Gemini 3.7 Flash 已配置；不可用时系统会自动降级为产品 Skill。"
