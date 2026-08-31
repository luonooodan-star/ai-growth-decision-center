#!/bin/zsh
set -euo pipefail

readonly KEYCHAIN_SERVICE="ai-growth-doris-superset-mcp"
readonly ACCESS_KEYCHAIN_SERVICE="ai-growth-decision-center-access"
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
require_command security "macOS Keychain 不可用。"
require_command launchctl "macOS launchd 不可用。"

node_supported="$(node -p '
  const [major, minor] = process.versions.node.split(".").map(Number);
  Number(major > 22 || (major === 22 && minor >= 13));
')"
[[ "$node_supported" == "1" ]] || \
  fail "当前 Node.js 为 $(node --version)，需要 22.13 或更高版本。"

cd "$project_dir"

if [[ "$project_dir" == "$HOME/Downloads/"* ]]; then
  print -u2 "提示：建议将服务放到 $HOME/Services/，避免 macOS 对 Downloads 的后台访问限制。"
fi

print "[1/6] 安装项目依赖"
npm ci

print "[2/6] 设置决策中心访问密码"
print -n "请输入至少 12 位的访问密码（输入不会显示）："
read -r -s access_password
print
(( ${#access_password} >= 12 )) || fail "访问密码至少需要 12 位。"

security add-generic-password \
  -a "$USER" \
  -s "$ACCESS_KEYCHAIN_SERVICE" \
  -w "$access_password" \
  -U >/dev/null
unset access_password

print "[3/6] 保存 Doris/Superset MCP Key"
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

print "[4/6] 校验 Doris 只读连接"
export DORIS_SUPERSET_MCP_TOKEN="$(security find-generic-password \
  -a "$USER" \
  -s "$KEYCHAIN_SERVICE" \
  -w)"
node "$project_dir/scripts/company-mac/mcp-whoami.mjs"

print "[5/6] 校验代码并安装开机常驻服务"
npm run type:check
npm run build:company

mkdir -p "$launch_agents_dir" "$logs_dir"
start_script="$project_dir/scripts/company-mac/start-local.sh"
chmod +x \
  "$start_script" \
  "$project_dir/scripts/company-mac/configure-glm.sh" \
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

print "[6/6] 等待服务启动"
health_url="http://localhost:8081/health/live"
for attempt in {1..30}; do
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    print "部署完成：$health_url"
    print "本机页面：http://localhost:8081/（用户名 growth）"
    [[ -n "$lan_ip" ]] && print "局域网页面：http://$lan_ip:8081/（同一公司网络内访问）"
    print "Doris 验证：node scripts/company-mac/mcp-whoami.mjs"
    print "默认 Gemini 3.7 Flash：zsh scripts/company-mac/configure-gemini.sh"
    print "未配置 Gemini 时会自动使用产品 Skill 规则。"
    exit 0
  fi
  sleep 2
done

print -u2 "服务未在 60 秒内就绪，请查看：$logs_dir/service-error.log"
exit 1
