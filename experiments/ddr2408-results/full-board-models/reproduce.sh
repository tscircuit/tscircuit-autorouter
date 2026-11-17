#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
router_root="$(cd -- "${1:?Pass a router checkout}" && pwd)"
core_root="$(cd -- "${2:?Pass a core checkout}" && pwd)"
output_root="${3:?Pass an absolute output directory}"

(cd "$router_root" && bun install --ignore-scripts)
(cd "$core_root" && bun install --ignore-scripts)
(cd "$router_root" && bun build lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts --target bun --packages external --outfile benchmark-runtime/pipeline9.js)
cd "$script_dir"
bun install --frozen-lockfile --ignore-scripts
bun build-core.ts "$core_root"
export FULL_BOARD_CORE_SOURCE="$core_root"
export FULL_BOARD_ROUTER_MODULE="$router_root/benchmark-runtime/pipeline9.js"
export FULL_BOARD_ROUTER_COMMIT="$(git -C "$router_root" rev-parse HEAD)"
export FULL_BOARD_CAPTURE_STAGE_INPUTS=1
for board in orangecrab h616 butterstick glider imx6 icepi; do
  export FULL_BOARD_CASE_IDS="$board"
  BUN_OPTIONS="--preload=$PWD/select-ddr-router.mjs" bun "$core_root/node_modules/@tscircuit/core-ddr-benchmark/scripts/run.ts" --core "$core_root" --circuit "$board" --out "$output_root/$board/ddr" --timeout 600
  FULL_BOARD_VARIANT=reproduced bun plane-suite.ts "$output_root/$board/full"
done
