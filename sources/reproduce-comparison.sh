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
    commit=24f154d17cf2c54186b842bdab2f990edcf42a31
  else
    commit=52c462b66aedbfc12a5fd34925acf3e7da48c5c5
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
assert package[sections[0]]['@tscircuit/fanout-solver']=='0.0.88'
package[sections[0]]['@tscircuit/fanout-solver']='https://codeload.github.com/tscircuit/fanout-solver/tar.gz/578e4cae538943e3d4814b58f6dd81062c918555'
path.write_text(json.dumps(package,indent=2)+'\n')
PYCORE
fi
export FULL_BOARD_CAPTURE_STAGE_INPUTS=1
if [[ "$revision" == after ]]; then export FULL_BOARD_FANOUT_VERSION="0.0.88+578e4ca"; fi
bash "$script_dir/reproduce.sh" "$runtime_root/tscircuit-autorouter" "$runtime_root/core" "$output_root"
