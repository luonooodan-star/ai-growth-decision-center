#!/bin/zsh
set -euo pipefail

readonly GLM_KEYCHAIN_SERVICE="ai-growth-decision-center-glm"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

print -n "请输入智谱开放平台 GLM API Key（输入不会显示）："
read -r -s glm_api_key
print
[[ -n "$glm_api_key" ]] || {
  print -u2 "错误：GLM API Key 不能为空。"
  exit 1
}

security add-generic-password \
  -a "$USER" \
  -s "$GLM_KEYCHAIN_SERVICE" \
  -w "$glm_api_key" \
  -U >/dev/null
unset glm_api_key

node "$project_dir/scripts/company-mac/glm-whoami.mjs"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || true
print "GLM-4.7-Flash 已配置；不可用时系统会自动降级为产品 Skill。"
