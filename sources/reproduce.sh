#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
router_root="$(cd -- "${1:?Pass a router checkout at 9910d3a5}" && pwd)"
core_root="$(cd -- "${2:?Pass a core checkout at 19297677}" && pwd)"
output_root="${3:?Pass an absolute output directory}"
(cd "$router_root" && bun install --ignore-scripts)
(cd "$core_root" && bun install --ignore-scripts)
(cd "$router_root" && bun build lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts --target bun --packages external --outfile benchmark-runtime/pipeline9.js)
cd "$script_dir"
bun install --frozen-lockfile --ignore-scripts
bun build-core.ts "$core_root"
export FULL_BOARD_CORE_SOURCE="$core_root"
export FULL_BOARD_CORE_MODULE="$PWD/patched-core/index.js"
export FULL_BOARD_COPPER_MODULE="$PWD/patched-core/find-floating-copper.js"
export FULL_BOARD_ROUTER_MODULE="$router_root/benchmark-runtime/pipeline9.js"
export FULL_BOARD_ROUTER_COMMIT="$(git -C "$router_root" rev-parse HEAD)"
for board in orangecrab h616 butterstick glider imx6 icepi; do
  mkdir -p "$output_root/$board"
  cp patched-core/build.json "$output_root/$board/core-build.json"
  cp "$core_root/package.json" "$output_root/$board/core-package.json"
  cp package.json "$output_root/$board/runtime-package.json"
  cp bun.lock "$output_root/$board/runtime-bun.lock"
  bun inspect-routing-workflow.tsx "$board" "$output_root/$board/plan.json"
  bun run-fanout-bus-first.ts "$board" "$output_root/$board"
done
