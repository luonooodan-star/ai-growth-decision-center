#!/bin/zsh
set -euo pipefail

readonly MAVIS_KEYCHAIN_SERVICE="ai-growth-decision-center-mavis-mcp"
readonly MAVIS_MODE_KEYCHAIN_SERVICE="ai-growth-decision-center-mavis-mode"
readonly LAUNCH_AGENT_LABEL="com.luonooodan.ai-growth-decision-center"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"
token="$(security find-generic-password \
  -a "$USER" \
  -s "$MAVIS_KEYCHAIN_SERVICE" \
  -w 2>/dev/null)" || {
  token="$(openssl rand -hex 32)"
  security add-generic-password \
    -a "$USER" \
    -s "$MAVIS_KEYCHAIN_SERVICE" \
    -w "$token" \
    -U >/dev/null
}

requested_mode="${1:-status}"
case "$requested_mode" in
  status)
    ;;
  simulation)
    security add-generic-password \
      -a "$USER" -s "$MAVIS_MODE_KEYCHAIN_SERVICE" \
      -w "skill_simulation" -U >/dev/null
    ;;
  external)
    security add-generic-password \
      -a "$USER" -s "$MAVIS_MODE_KEYCHAIN_SERVICE" \
      -w "external" -U >/dev/null
    ;;
  *)
    print -u2 "用法：zsh scripts/company-mac/configure-mavis.sh [status|simulation|external]"
    exit 1
    ;;
esac

mode="$(security find-generic-password \
  -a "$USER" -s "$MAVIS_MODE_KEYCHAIN_SERVICE" \
  -w 2>/dev/null)" || mode="skill_simulation"

if [[ "$requested_mode" != "status" ]]; then
  launchctl kickstart -k \
    "gui/$(id -u)/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1 || true
fi

lan_ip="$(ipconfig getifaddr en0 2>/dev/null || \
  ipconfig getifaddr en1 2>/dev/null || true)"
mcp_host="${lan_ip:-127.0.0.1}"

print "Mavis MCP 已准备好。"
print "URL：http://$mcp_host:8081/mcp/growth-decision"
print "HTTP Basic：使用页面账号 growth 和页面访问密码"
print "X-Mavis-Token：$token"
if [[ "$mode" == "external" ]]; then
  print "当前模式：外部 Mavis Worker（新任务等待 Mavis 领取）。"
else
  print "当前模式：产品 Skill 模拟运行。"
fi
print "真实 Mavis 接入后，将该 URL 和 X-Mavis-Token 配到它的 MCP 客户端。"
print "切到外部模式：zsh scripts/company-mac/configure-mavis.sh external"
print "切回模拟模式：zsh scripts/company-mac/configure-mavis.sh simulation"
print "项目目录：$project_dir"
