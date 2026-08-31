#!/bin/zsh
set -euo pipefail

readonly KEYCHAIN_SERVICE="ai-growth-doris-superset-mcp"
readonly ACCESS_KEYCHAIN_SERVICE="ai-growth-decision-center-access"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

token="$(security find-generic-password \
  -a "$USER" \
  -s "$KEYCHAIN_SERVICE" \
  -w 2>/dev/null)" || {
  print -u2 "Doris MCP Key 不存在，请重新运行 setup.sh。"
  exit 1
}

access_password="$(security find-generic-password \
  -a "$USER" \
  -s "$ACCESS_KEYCHAIN_SERVICE" \
  -w 2>/dev/null)" || {
  print -u2 "决策中心访问密码不存在，请重新运行 setup.sh。"
  exit 1
}

cd "$project_dir"

# 所有运行配置都来自公司 Mac，不读取妙搭环境。
export DORIS_MCP_URL="${DORIS_MCP_URL:-http://192.168.3.102:8766/mcp}"
export SUPERSET_MCP_URL="${SUPERSET_MCP_URL:-http://192.168.3.102:8767/mcp}"
export DORIS_SUPERSET_MCP_TOKEN="$token"
export GROWTH_BASIC_AUTH_PASSWORD="$access_password"
export SERVER_HOST="0.0.0.0"
export SERVER_PORT="8081"
export GROWTH_DATABASE_PATH="$project_dir/runtime/ai-growth.sqlite"

exec env NODE_ENV=production node "$project_dir/dist/server/standalone.js"
