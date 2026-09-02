#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
exec zsh "$script_dir/configure-marvis-remote.sh" "$@"
