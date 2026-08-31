#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h:h}"

cd "$project_dir"
exec npm run dev:local
