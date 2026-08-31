#!/bin/zsh
set -euo pipefail

readonly KEYCHAIN_SERVICE="ai-growth-doris-superset-mcp"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

token="$(security find-generic-password \
  -a "$USER" \
  -s "$KEYCHAIN_SERVICE" \
  -w 2>/dev/null)" || {
  print -u2 "Doris MCP Key 不存在，请重新运行 setup.sh。"
  exit 1
}

cd "$project_dir"

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

if [[ -f ".env.local" ]]; then
  set -a
  source ".env.local"
  set +a
fi

# 服务器端口以公司 Mac 部署值为准，不受妙搭开发环境覆盖。
export DORIS_MCP_URL="${DORIS_MCP_URL:-http://192.168.3.102:8766/mcp}"
export SUPERSET_MCP_URL="${SUPERSET_MCP_URL:-http://192.168.3.102:8767/mcp}"
export DORIS_SUPERSET_MCP_TOKEN="$token"
export SERVER_HOST="0.0.0.0"
export SERVER_PORT="8081"

exec env NODE_ENV=production node "$project_dir/dist/server/main.js"
