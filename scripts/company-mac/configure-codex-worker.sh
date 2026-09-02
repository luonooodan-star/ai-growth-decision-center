#!/bin/zsh
set -euo pipefail

readonly SERVICE_LABEL="com.luonooodan.ai-growth-codex-bridge"
readonly PLIST="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"
readonly READY_FILE="$project_dir/.runtime/codex-bridge.ready"
bridge_script="$script_dir/codex-bridge-server.mjs"
worker_script="$script_dir/codex-worker.mjs"
command="${1:-setup}"
node_path="$(command -v node)"

if [[ "$command" == "status" ]]; then
  launchctl print "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || {
    print "Codex 本机凭据桥未运行。"
    exit 1
  }
  [[ -f "$READY_FILE" ]] || {
    print "Codex 本机凭据桥已注册，但文件队列尚未就绪。"
    exit 1
  }
  node "$worker_script" check
  exit 0
fi

if [[ "$command" != "setup" ]]; then
  print -u2 "用法：zsh configure-codex-worker.sh [setup|status]"
  exit 1
fi

[[ -n "$node_path" ]] || {
  print -u2 "错误：未找到 Node.js。"
  exit 1
}
[[ -f "$bridge_script" && -f "$worker_script" ]] || {
  print -u2 "错误：Codex Worker 文件不完整，请先更新项目。"
  exit 1
}

for service in \
  ai-growth-decision-center-marvis-remote-url \
  ai-growth-decision-center-marvis-remote-password \
  ai-growth-decision-center-marvis-remote-token
do
  security find-generic-password -a "$USER" -s "$service" >/dev/null 2>&1 || {
    print -u2 "错误：远程连接凭据不完整。"
    print -u2 "请先运行：zsh scripts/company-mac/configure-codex-remote.sh setup"
    exit 1
  }
done

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
escaped_project="${project_dir//&/&amp;}"
escaped_node="${node_path//&/&amp;}"
escaped_bridge="${bridge_script//&/&amp;}"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node</string>
    <string>$escaped_bridge</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$escaped_project</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/ai-growth-codex-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/ai-growth-codex-bridge.error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$READY_FILE"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"

for _ in {1..20}; do
  [[ -f "$READY_FILE" ]] && break
  sleep 0.25
done

[[ -f "$READY_FILE" ]] || {
  print -u2 "Codex 本机凭据桥启动失败，请查看："
  print -u2 "$HOME/Library/Logs/ai-growth-codex-bridge.error.log"
  exit 1
}

print "Codex 本机凭据桥已启动，开始连接检查。"
node "$worker_script" check
