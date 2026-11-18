#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
revision="${1:?Pass before or after}"
output_root="${2:?Pass an absolute output directory}"
case "$revision" in before|after) ;; *) exit 2 ;; esac
[[ "$output_root" == /* ]]
[[ "$(bun --version)" == "1.4.3" ]]
runtime_root="$(mktemp -d /tmp/native-plane-drop-replay.XXXXXX)"
trap 'rm -rf -- "$runtime_root"' EXIT
for repo in core tscircuit-autorouter; do
  git init --quiet "$runtime_root/$repo"
  if [[ "$repo" == core ]]; then
    commit=1a16da2f74fc2c80712d52abb17254dd2a80e2c5
  else
    commit=83180d0881807ce08dc38b0cc226b9eb8fcca59d
  fi
  git -C "$runtime_root/$repo" fetch --quiet --depth 1 "https://github.com/tscircuit/$repo.git" "$commit"
  git -C "$runtime_root/$repo" checkout --quiet --detach FETCH_HEAD
done
if [[ "$revision" == after ]]; then
  python3 - "$runtime_root/core/package.json" <<'PYCORE'
import json,sys
from pathlib import Path
path=Path(sys.argv[1]);package=json.loads(path.read_text())
sections=[key for key in ['dependencies','devDependencies'] if '@tscircuit/fanout-solver' in package.get(key,{})]
assert len(sections)==1
assert package[sections[0]]['@tscircuit/fanout-solver']=='0.0.86'
package[sections[0]]['@tscircuit/fanout-solver']='https://codeload.github.com/tscircuit/fanout-solver/tar.gz/63f735cb2d5b3b93c5ec1f0d39ab607c3212594e'
path.write_text(json.dumps(package,indent=2)+'\n')
PYCORE
fi
export FULL_BOARD_CAPTURE_STAGE_INPUTS=1
bash "$script_dir/reproduce.sh" "$runtime_root/tscircuit-autorouter" "$runtime_root/core" "$output_root"
