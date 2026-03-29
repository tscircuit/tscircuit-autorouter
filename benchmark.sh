#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME=""
SCENARIO_LIMIT=""
EFFORT=""
SAMPLE_TIMEOUT=""
INCLUDE_ASSIGNABLE=false
DATASET="dataset01"
DEFAULT_SOLVER_NAME="AutoroutingPipelineSolver4"
PIPELINE_ID=""

resolve_pipeline_solver_name() {
  case "$1" in
    1) echo "AutoroutingPipeline1_OriginalUnravel" ;;
    2) echo "AutoroutingPipelineSolver2_PortPointPathing" ;;
    3) echo "AutoroutingPipelineSolver3_HgPortPointPathing" ;;
    4) echo "AutoroutingPipelineSolver4" ;;
    *)
      echo "Unknown pipeline: $1" >&2
      exit 1
      ;;
  esac
}

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
    const pipelineNames = new Set()
    for (const match of pipelinesIndex.matchAll(/export\s*\{([\s\S]*?)\}\s*from/g)) {
      const exportEntries = match[1].split(",").map((entry) => entry.trim()).filter(Boolean)
      for (const entry of exportEntries) {
        const localName = entry.split(/\s+as\s+/)[0]?.trim()
        if (localName) pipelineNames.add(localName)
      }
    }

    // Resolve aliases from lib/index.ts
    const libIndex = readFileSync(join(process.cwd(), "lib", "index.ts"), "utf8")
    const solvers = [...pipelineNames].flatMap(name => {
      const aliasMatches = [...libIndex.matchAll(new RegExp(name + "\\s+as\\s+(\\w+)", "g"))].map(match => match[1])
      return [name, ...aliasMatches]
    })
    const uniqueSolvers = [...new Set(solvers)]

    const includeAssignable = process.env.INCLUDE_ASSIGNABLE === "true"
    const filtered = includeAssignable ? uniqueSolvers : uniqueSolvers.filter(name => !name.includes("Assignable"))

    console.log(filtered.join("\n"))
  ' 2>/dev/null || true
}

print_help() {
  cat <<'EOF'
Usage:
  ./benchmark.sh [solver-name|all] [scenario-limit] [--concurrency N] [--effort N] [--sample-timeout DURATION] [--dataset NAME] [--include-assignable]
  ./benchmark.sh [--solver NAME] [--pipeline N] [--scenario-limit N] [--concurrency N] [--effort N] [--sample-timeout DURATION] [--dataset NAME] [--include-assignable]

Options:
  --solver NAME        Run only one solver (same as first positional arg)
  --pipeline N         Run a numbered pipeline alias (1-4)
  --scenario-limit N   Run only first N scenarios (same as second positional arg)
  --concurrency N      Number of Bun workers used per solver, or "auto"
  --effort N           Override scenario effort multiplier
  --sample-timeout D   Override per-sample timeout directly; otherwise timeout is 60s + 60s * effort
  --dataset NAME       Dataset to benchmark: dataset01 (default), zdwiel, or srj05
  --include-assignable Include assignable pipelines (excluded by default)
  -h, --help           Show this help

Defaults:
  Running ./benchmark.sh with no parameters benchmarks only AutoroutingPipelineSolver4.
  Use "all" to benchmark every available solver.

Examples:
  ./benchmark.sh
  ./benchmark.sh AutoroutingPipelineSolver4
  ./benchmark.sh all 20 --concurrency auto
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --effort 2
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --sample-timeout 90s
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --scenario-limit 20
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --dataset zdwiel --scenario-limit 20
  ./benchmark.sh --pipeline 4
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --dataset srj05 --scenario-limit 20
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
    --pipeline)
      PIPELINE_ID="${2:-}"
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

if [ -n "$PIPELINE_ID" ]; then
  SOLVER_NAME="$(resolve_pipeline_solver_name "$PIPELINE_ID")"
fi

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
