#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME=""
SCENARIO_LIMIT=""
EFFORT=""
SAMPLE_TIMEOUT=""
INCLUDE_ASSIGNABLE=false
DATASET="dataset01"
DEFAULT_SOLVER_NAME="AutoroutingPipelineSolver"

default_concurrency() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4
}

CONCURRENCY="${BENCHMARK_CONCURRENCY:-$(default_concurrency)}"

get_solvers() {
  INCLUDE_ASSIGNABLE="$INCLUDE_ASSIGNABLE" bun --eval '
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

    const includeAssignable = process.env.INCLUDE_ASSIGNABLE === "true"
    const filtered = includeAssignable ? solvers : solvers.filter(name => !name.includes("Assignable"))

    console.log(filtered.join("\n"))
  ' 2>/dev/null || true
}

print_help() {
  cat <<'EOF'
Usage:
  ./benchmark.sh [solver-name|all] [scenario-limit] [--concurrency N] [--effort N] [--sample-timeout DURATION] [--dataset NAME] [--include-assignable]
  ./benchmark.sh [--solver NAME] [--scenario-limit N] [--concurrency N] [--effort N] [--sample-timeout DURATION] [--dataset NAME] [--include-assignable]

Options:
  --solver NAME        Run only one solver (same as first positional arg)
  --scenario-limit N   Run only first N scenarios (same as second positional arg)
  --concurrency N      Number of Bun workers used per solver, or "auto"
  --effort N           Override scenario effort multiplier
  --sample-timeout D   Override per-sample timeout directly; otherwise timeout is 60s + 60s * effort
  --dataset NAME       Dataset to benchmark: dataset01 (default) or zdwiel
  --include-assignable Include assignable pipelines (excluded by default)
  -h, --help           Show this help

Defaults:
  Running ./benchmark.sh with no parameters benchmarks only AutoroutingPipelineSolver.
  Use "all" to benchmark every available solver.

Examples:
  ./benchmark.sh
  ./benchmark.sh AutoroutingPipelineSolver
  ./benchmark.sh all 20 --concurrency auto
  ./benchmark.sh --solver AutoroutingPipelineSolver --effort 2
  ./benchmark.sh --solver AutoroutingPipelineSolver --sample-timeout 90s
  ./benchmark.sh --solver AutoroutingPipelineSolver --scenario-limit 20
  ./benchmark.sh --solver AutoroutingPipelineSolver --dataset zdwiel --scenario-limit 20
  ./benchmark.sh --include-assignable
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
      if [ "$CONCURRENCY" = "auto" ]; then
        CONCURRENCY="$(default_concurrency)"
      fi
      shift 2
      ;;
    --effort)
      EFFORT="${2:-}"
      shift 2
      ;;
    --sample-timeout)
      SAMPLE_TIMEOUT="${2:-}"
      shift 2
      ;;
    --dataset)
      DATASET="${2:-}"
      shift 2
      ;;
    --include-assignable)
      INCLUDE_ASSIGNABLE=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Run ./benchmark.sh --help for usage"
      exit 1
      ;;
  esac
done

CMD=(bun "scripts/benchmark/index.ts" "--concurrency" "$CONCURRENCY")

if [ -z "$SOLVER_NAME" ]; then
  SOLVER_NAME="$DEFAULT_SOLVER_NAME"
fi

if [ -n "$SOLVER_NAME" ] && [ "$SOLVER_NAME" != "_" ] && [ "$SOLVER_NAME" != "all" ]; then
  CMD+=("--solver" "$SOLVER_NAME")
fi

if [ -n "$SCENARIO_LIMIT" ]; then
  CMD+=("--scenario-limit" "$SCENARIO_LIMIT")
fi

if [ -n "$EFFORT" ]; then
  CMD+=("--effort" "$EFFORT")
fi

if [ -n "$SAMPLE_TIMEOUT" ]; then
  CMD+=("--sample-timeout" "$SAMPLE_TIMEOUT")
fi

if [ -n "$DATASET" ]; then
  CMD+=("--dataset" "$DATASET")
fi

if [ "$INCLUDE_ASSIGNABLE" != true ]; then
  CMD+=("--exclude-assignable")
fi

"${CMD[@]}"
