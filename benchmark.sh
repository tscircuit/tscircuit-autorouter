#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME=""
SCENARIO_LIMIT=""
CONCURRENCY="${BENCHMARK_CONCURRENCY:-4}"

get_solvers() {
  bun --eval '
    import { readFileSync } from "node:fs"
    import { join } from "node:path"

    // Use autorouter-pipelines/index.ts as the source of truth for benchmarkable solvers
    const pipelinesIndex = readFileSync(join(process.cwd(), "lib", "autorouter-pipelines", "index.ts"), "utf8")
    const pipelineNames = [...pipelinesIndex.matchAll(/export\s*\{\s*(\w+)\s*\}/g)].map(m => m[1])

    // Resolve aliases from lib/index.ts
    const libIndex = readFileSync(join(process.cwd(), "lib", "index.ts"), "utf8")
    const solvers = pipelineNames.map(name => {
      const aliasMatch = libIndex.match(new RegExp(name + "\\s+as\\s+(\\w+)"))
      return aliasMatch ? aliasMatch[1] : name
    })

    console.log(solvers.join("\n"))
  ' 2>/dev/null || true
}

print_help() {
  cat <<'EOF'
Usage:
  ./benchmark.sh [solver-name|_] [scenario-limit] [--concurrency N]
  ./benchmark.sh [--solver NAME] [--scenario-limit N] [--concurrency N]

Options:
  --solver NAME        Run only one solver (same as first positional arg)
  --scenario-limit N   Run only first N scenarios (same as second positional arg)
  --concurrency N      Number of Bun workers used per solver (default: 4)
  -h, --help           Show this help

Examples:
  ./benchmark.sh
  ./benchmark.sh AutoroutingPipelineSolver
  ./benchmark.sh _ 20 --concurrency 8
  ./benchmark.sh --solver AutoroutingPipelineSolver --scenario-limit 20
EOF

  SOLVERS="$(get_solvers)"
  if [ -n "$SOLVERS" ]; then
    echo ""
    echo "Available solvers:"
    while IFS= read -r solver; do
      [ -n "$solver" ] && echo "  - $solver"
    done <<EOF
$SOLVERS
EOF
  fi
}

if [ "${1:-}" != "" ] && [[ "${1}" != --* ]]; then
  SOLVER_NAME="$1"
  shift
fi

if [ "${1:-}" != "" ] && [[ "${1}" != --* ]]; then
  SCENARIO_LIMIT="$1"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      print_help
      exit 0
      ;;
    --solver)
      SOLVER_NAME="${2:-}"
      shift 2
      ;;
    --scenario-limit)
      SCENARIO_LIMIT="${2:-}"
      shift 2
      ;;
    --concurrency)
      CONCURRENCY="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Run ./benchmark.sh --help for usage"
      exit 1
      ;;
  esac
done

CMD=(bun "scripts/benchmark/index.ts" "--concurrency" "$CONCURRENCY")

if [ -n "$SOLVER_NAME" ] && [ "$SOLVER_NAME" != "_" ]; then
  CMD+=("--solver" "$SOLVER_NAME")
fi

if [ -n "$SCENARIO_LIMIT" ]; then
  CMD+=("--scenario-limit" "$SCENARIO_LIMIT")
fi

"${CMD[@]}"
