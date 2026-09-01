#!/bin/zsh
set -euo pipefail

readonly MARVIS_SKILL_NAME="growth-decision-analyst"

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"
skill_dir="$project_dir/marvis-skills/$MARVIS_SKILL_NAME"
output_dir="$HOME/Downloads/ai-growth-marvis"
skill_zip="$output_dir/$MARVIS_SKILL_NAME.zip"

if [[ ! -f "$skill_dir/SKILL.md" ]]; then
  print -u2 "错误：找不到 Marvis Skill：$skill_dir/SKILL.md"
  exit 1
fi

mkdir -p "$output_dir"
rm -f "$skill_zip"
ditto -c -k --sequesterRsrc --keepParent "$skill_dir" "$skill_zip"
cp "$skill_dir/automatic-task-prompt.md" "$output_dir/automatic-task-prompt.md"
cp "$project_dir/scripts/company-mac/marvis-worker.mjs" "$output_dir/marvis-worker.mjs"
cp "$project_dir/scripts/company-mac/configure-marvis-remote.sh" \
  "$output_dir/configure-marvis-remote.sh"
chmod 700 "$output_dir/marvis-worker.mjs"
chmod 700 "$output_dir/configure-marvis-remote.sh"

print "Marvis 接入包已生成："
print "Skill：$skill_zip"
print "自动任务提示词：$output_dir/automatic-task-prompt.md"
print "本地安全代理：$output_dir/marvis-worker.mjs"
print "远程配置脚本：$output_dir/configure-marvis-remote.sh"
print ""
print "先连接公司 Mac："
print "zsh \"$output_dir/configure-marvis-remote.sh\" setup"
print ""
print "在 Marvis 中完成以下两步："
print "1. 技能广场 → 导入本地 Skill，选择上面的 zip。"
print "2. 自动任务 → 新建任务，粘贴 automatic-task-prompt.md 内容，频率设为每 30 分钟。"
print "   页面刚创建分析任务且需要立即结果时，在 Marvis 中手动点击一次“运行”。"
print ""
print "公司 Mac 端需要切到外部 Worker 模式："
print "zsh scripts/company-mac/configure-mavis.sh external"
