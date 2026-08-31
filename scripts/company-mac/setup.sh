#!/bin/zsh
set -euo pipefail

readonly APP_ID="app_17cyvrepg1x"
readonly KEYCHAIN_SERVICE="ai-growth-doris-superset-mcp"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"
launch_agents_dir="$HOME/Library/LaunchAgents"
logs_dir="$HOME/Library/Logs/ai-growth-decision-center"
plist_path="$launch_agents_dir/$LAUNCH_AGENT_LABEL.plist"

fail() {
  print -u2 "错误：$1"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少 $1：$2"
}

[[ "$(uname -s)" == "Darwin" ]] || fail "该脚本仅支持 macOS。"

require_command git "请先安装 Xcode Command Line Tools：xcode-select --install"
require_command node "需要 Node.js 22 或更高版本。"
require_command npm "需要随 Node.js 安装 npm。"
require_command lark-cli \
  "请先安装：npm install -g --prefix \"$HOME/.local\" @larksuite/cli"
require_command security "macOS Keychain 不可用。"
require_command launchctl "macOS launchd 不可用。"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 22 )) || fail "当前 Node.js 为 $(node --version)，需要 22 或更高版本。"

cd "$project_dir"

print "[1/7] 安装项目依赖"
npm ci

print "[2/7] 检查飞书妙搭授权"
if ! lark-cli auth status --verify >/dev/null 2>&1; then
  print "需要在浏览器完成一次飞书授权。"
  lark-cli auth login --domain apps
fi

print "[3/7] 拉取本地运行环境"
if ! lark-cli apps +env-pull --app-id "$APP_ID" --as user; then
  print "当前授权缺少妙搭应用权限，重新授权后再试。"
  lark-cli auth login --domain apps
  lark-cli apps +env-pull --app-id "$APP_ID" --as user
fi

print "[4/7] 保存 Doris/Superset MCP Key"
print -n "请输入 dmcp_ 开头的 API Key（输入不会显示）："
read -r -s mcp_token
print
[[ "$mcp_token" == dmcp_* ]] || fail "API Key 格式不正确，应以 dmcp_ 开头。"

security add-generic-password \
  -a "$USER" \
  -s "$KEYCHAIN_SERVICE" \
  -w "$mcp_token" \
  -U >/dev/null
unset mcp_token

print "[5/7] 校验 Doris 只读连接"
export DORIS_SUPERSET_MCP_TOKEN="$(security find-generic-password \
  -a "$USER" \
  -s "$KEYCHAIN_SERVICE" \
  -w)"
node "$project_dir/scripts/company-mac/mcp-whoami.mjs"

print "[6/7] 校验代码并安装开机常驻服务"
npm run type:check
npm run build:prod

mkdir -p "$launch_agents_dir" "$logs_dir"
start_script="$project_dir/scripts/company-mac/start-local.sh"
chmod +x \
  "$start_script" \
  "$project_dir/scripts/company-mac/update.sh"

escaped_start_script="${start_script//&/&amp;}"
escaped_start_script="${escaped_start_script//</&lt;}"
escaped_start_script="${escaped_start_script//>/&gt;}"
escaped_project_dir="${project_dir//&/&amp;}"
escaped_project_dir="${escaped_project_dir//</&lt;}"
escaped_project_dir="${escaped_project_dir//>/&gt;}"
escaped_path="${PATH//&/&amp;}"
escaped_path="${escaped_path//</&lt;}"
escaped_path="${escaped_path//>/&gt;}"
escaped_logs_dir="${logs_dir//&/&amp;}"
escaped_logs_dir="${escaped_logs_dir//</&lt;}"
escaped_logs_dir="${escaped_logs_dir//>/&gt;}"

tmp_plist="$(mktemp)"
trap 'rm -f "$tmp_plist"' EXIT

cat >"$tmp_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_start_script</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$escaped_project_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$escaped_path</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$escaped_logs_dir/service.log</string>
  <key>StandardErrorPath</key>
  <string>$escaped_logs_dir/service-error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$tmp_plist" >/dev/null
cp "$tmp_plist" "$plist_path"

launchctl bootout "gui/$(id -u)" "$plist_path" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist_path"
launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL"

print "[7/7] 等待服务启动"
health_url="http://localhost:8081/app/$APP_ID/"
for attempt in {1..30}; do
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    print "部署完成：$health_url"
    print "Doris 验证：node scripts/company-mac/mcp-whoami.mjs"
    exit 0
  fi
  sleep 2
done

print -u2 "服务未在 60 秒内就绪，请查看：$logs_dir/service-error.log"
exit 1
