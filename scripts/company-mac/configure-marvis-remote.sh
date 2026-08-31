#!/bin/zsh
set -euo pipefail

readonly REMOTE_URL_SERVICE="ai-growth-decision-center-marvis-remote-url"
readonly REMOTE_USER_SERVICE="ai-growth-decision-center-marvis-remote-user"
readonly REMOTE_PASSWORD_SERVICE="ai-growth-decision-center-marvis-remote-password"
readonly REMOTE_TOKEN_SERVICE="ai-growth-decision-center-marvis-remote-token"

script_dir="${0:A:h}"
worker_script="$script_dir/marvis-worker.mjs"
command="${1:-setup}"

keychain_read() {
  security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null
}

keychain_write() {
  security add-generic-password -a "$USER" -s "$1" -w "$2" -U >/dev/null
}

if [[ "$command" == "status" ]]; then
  remote_url="$(keychain_read "$REMOTE_URL_SERVICE" || true)"
  remote_user="$(keychain_read "$REMOTE_USER_SERVICE" || true)"
  if [[ -z "$remote_url" ]]; then
    print "尚未配置远程公司 Mac。"
    exit 1
  fi
  print "公司 Mac MCP：$remote_url"
  print "访问用户：${remote_user:-growth}"
  print "访问密码：已保存在当前 Mac Keychain"
  print "Marvis Token：已保存在当前 Mac Keychain"
  exit 0
fi

if [[ "$command" != "setup" ]]; then
  print -u2 "用法：zsh configure-marvis-remote.sh [setup|status]"
  exit 1
fi

print "配置本 Mac 的 Marvis Worker 连接。认证信息只保存到当前 Mac Keychain。"
print -n "公司 Mac 页面地址（例如 http://192.168.3.173:8081）："
read -r server_url
server_url="${server_url%/}"
[[ "$server_url" == http://* || "$server_url" == https://* ]] || {
  print -u2 "地址必须以 http:// 或 https:// 开头。"
  exit 1
}
if [[ "$server_url" != */mcp/growth-decision ]]; then
  server_url="$server_url/mcp/growth-decision"
fi

print -n "页面用户名（直接回车使用 growth）："
read -r remote_user
remote_user="${remote_user:-growth}"

print -n "请输入公司 Mac 的页面访问密码（输入不会显示）："
read -r -s remote_password
print
[[ -n "$remote_password" ]] || {
  print -u2 "页面访问密码不能为空。"
  exit 1
}

print -n "请输入公司 Mac 输出的 X-Marvis-Token（输入不会显示）："
read -r -s remote_token
print
[[ -n "$remote_token" ]] || {
  print -u2 "Marvis Token 不能为空。"
  exit 1
}

keychain_write "$REMOTE_URL_SERVICE" "$server_url"
keychain_write "$REMOTE_USER_SERVICE" "$remote_user"
keychain_write "$REMOTE_PASSWORD_SERVICE" "$remote_password"
keychain_write "$REMOTE_TOKEN_SERVICE" "$remote_token"
unset remote_password remote_token

print "远程认证已保存，开始无副作用连接检查。"
node "$worker_script" check

