import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import type { BenchmarkReport } from "./benchmark-types"

// Exploratory branch only: exact source patches keep each experiment reproducible.
const cleanupPath = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver.ts"
const dependencyRoot = "node_modules/@tscircuit/trace-simplification-solver/lib/solvers"
const detourPath = `${dependencyRoot}/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver.ts`
const mergePath = `${dependencyRoot}/SameNetViaMergerSolver/SameNetViaMergerSolver.ts`
const workerPath = "scripts/benchmark/benchmark-run-task.ts"
const paths = [cleanupPath, detourPath, mergePath, workerPath]
const originals = new Map(paths.map((path) => [path, readFileSync(path, "utf8")]))
const flag = "(globalThis as any).__cleanupStrategyActive"
function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw new Error(`Expected one patch site: ${from}`)
  return source.replace(from, to)
}
const strategies = [
  { name: "control", passes: 2, salvage: false, detours: false, merge: false },
  { name: "eight-passes", passes: 8, salvage: false, detours: false, merge: false },
  { name: "local-acceptance", passes: 2, salvage: true, detours: false, merge: false },
  { name: "both-detour-anchors", passes: 2, salvage: false, detours: true, merge: false },
  { name: "wider-via-merging", passes: 2, salvage: false, detours: false, merge: true },
  { name: "vertex-shortcuts", passes: 2, salvage: false, detours: false, merge: false },
  { name: "vertex-local-acceptance", passes: 2, salvage: true, detours: false, merge: false },
  { name: "phase-checkpoints", passes: 2, salvage: true, detours: false, merge: false },
  { name: "via-only-acceptance", passes: 2, salvage: true, detours: false, merge: false },
  { name: "combined", passes: 4, salvage: true, detours: true, merge: true },
]
const runs: { name: string; report: BenchmarkReport }[] = []
mkdirSync("benchmark-effort", { recursive: true })
try {
  for (const strategy of strategies.filter((s) => !process.env.CLEANUP_STRATEGIES || process.env.CLEANUP_STRATEGIES.split(",").includes(s.name))) {
    let cleanup = originals.get(cleanupPath)!
    cleanup = replaceOnce(cleanup, "Math.ceil(2 * (params.effort - 1))", `Math.ceil(${strategy.passes} * (params.effort - 1))`)
    cleanup = replaceOnce(cleanup, "    simplifier.step()", `    const previousPhase = simplifier.currentPhase\n    ;${flag} = true\n    simplifier.step()\n    ;${flag} = false`)
    if (process.env.CLEANUP_CAPTURE) {
      cleanup = 'import { writeFileSync } from "node:fs"\n' + cleanup
      cleanup = replaceOnce(cleanup, "      const cost = this.params.getCost(candidate)", '      writeFileSync("benchmark-effort/cleanup-candidate.json", JSON.stringify({ config: this.params.config, candidate, bestRoutes: this.bestRoutes }))\n      const cost = this.params.getCost(candidate)')
    }
    if (strategy.name.startsWith("vertex-")) {
      cleanup = replaceOnce(cleanup, "      ...params.config,", "      ...params.config,\n      enableVertexShortcuts: true,")
    }
    if (strategy.salvage) {
      cleanup = replaceOnce(cleanup, "if (completedPasses > this.completedPasses)", "if (completedPasses > this.completedPasses || previousPhase !== simplifier.currentPhase)")
      cleanup = replaceOnce(cleanup, "        this.bestCost = cost\n      }", `        this.bestCost = cost
      } else {
        const indices = candidate.map((route, index) => {
          const best = this.bestRoutes[index]
          if (!best || best.connectionName !== route.connectionName) {
            throw new Error("Cleanup changed route ordering")
          }
          return { index, viaGain: best.vias.length - route.vias.length, pointGain: best.route.length - route.route.length }
        }).filter(({ viaGain, pointGain }) => viaGain > 0 || (viaGain === 0 && pointGain > 0))
          .sort((a, b) => b.viaGain - a.viaGain || b.pointGain - a.pointGain).slice(0, 64)
        for (const { index } of indices) {
          const trial = [...this.bestRoutes]
          trial[index] = candidate[index]
          const trialCost = this.params.getCost(trial)
          if ((trialCost.vias < this.bestCost.vias || (trialCost.vias === this.bestCost.vias && trialCost.points < this.bestCost.points)) && this.params.isValid(trial)) {
            this.bestRoutes = structuredClone(trial)
            this.bestCost = trialCost
          }
        }
      }`)
    }
    if (strategy.name === "phase-checkpoints") {
      cleanup = replaceOnce(cleanup, ".slice(0, 64)", ".slice(0, 0)")
    }
    if (strategy.name === "via-only-acceptance") {
      cleanup = replaceOnce(cleanup, "viaGain > 0 || (viaGain === 0 && pointGain > 0)", "viaGain > 0")
    }
    writeFileSync(cleanupPath, cleanup)
    let detour = originals.get(detourPath)!
    if (strategy.detours) {
      detour = replaceOnce(detour, "    const candidateShortcuts: ViaPairShortcut[] = []", `    if (${flag}) {
      for (let previousIndex = 0; previousIndex < transitionIndex; previousIndex++) {
        for (let nextIndex = 1; nextIndex < nextSection.points.length; nextIndex++) {
          anchorPairs.push([previousIndex, nextIndex])
        }
      }
    }
    const candidateShortcuts: ViaPairShortcut[] = []`)
    }
    writeFileSync(detourPath, detour)
    let merger = originals.get(mergePath)!
    if (strategy.merge) {
      merger = replaceOnce(merger, "Math.ceil(NEAR_VIA_MERGE_DISTANCE_MULTIPLIER)", `Math.ceil(${flag} ? 6 : NEAR_VIA_MERGE_DISTANCE_MULTIPLIER)`)
      merger = replaceOnce(merger, "directOverlapDistance * NEAR_VIA_MERGE_DISTANCE_MULTIPLIER", `directOverlapDistance * (${flag} ? 6 : NEAR_VIA_MERGE_DISTANCE_MULTIPLIER)`)
    }
    writeFileSync(mergePath, merger)
    let worker = originals.get(workerPath)!
    worker = replaceOnce(worker, "    const viaCount = countTraceVias(traces)", `    const viaCount = countTraceVias(traces)
    let traceLengthMm = 0
    let wirePoints = 0
    for (const trace of traces) {
      for (let i = 0; i < trace.route.length; i++) {
        const point = trace.route[i]
        const previous = trace.route[i - 1]
        if (point.route_type !== "wire") continue
        wirePoints++
        if (previous?.route_type === "wire" && previous.layer === point.layer) {
          traceLengthMm += Math.hypot(point.x - previous.x, point.y - previous.y)
        }
      }
    }`)
    worker = replaceOnce(worker, "      viaCount,\n      traceLintIssueCounts,", "      viaCount,\n      traceLengthMm,\n      wirePoints,\n      traceLintIssueCounts,")
    writeFileSync(workerPath, worker)
    for (const path of paths) writeFileSync(`benchmark-effort/${strategy.name}-${path.split('/').at(-1)}`, readFileSync(path))
    if (process.argv.includes("--check")) {
      const check = spawnSync(process.execPath, ["test", "tests/features/cleanup-strategy-experiment.test.ts", "--timeout", "9999999"], { stdio: "inherit" })
      if (check.status !== 0) throw new Error(`Strategy fixture failed: ${strategy.name}`)
      continue
    }
    console.log(`\nSTART STRATEGY ${strategy.name}`)
    const result = spawnSync("bash", ["benchmark.sh", "--pipeline", "9", "--dataset", "18", "--effort", "2", "--sample-timeout", "1200s", "--concurrency", "8", ...(process.env.CLEANUP_SAMPLE_NUMBERS ? ["--sample-numbers", process.env.CLEANUP_SAMPLE_NUMBERS] : [])], { stdio: "inherit" })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${strategy.name} exited ${result.status}`)
    const raw = readFileSync("benchmark-result.json", "utf8")
    writeFileSync(`benchmark-effort/${strategy.name}.json`, raw)
    const report = JSON.parse(raw) as BenchmarkReport
    if (report.tests.length !== (process.env.CLEANUP_SAMPLE_NUMBERS ? process.env.CLEANUP_SAMPLE_NUMBERS.split(",").length : 16) || report.effortLabel !== "2x effort") throw new Error("Wrong experiment dataset/effort")
    runs.push({ name: strategy.name, report })
    writeFileSync("benchmark-effort/strategies.json", JSON.stringify(runs, null, 2))
  }
} finally {
  for (const [path, source] of originals) writeFileSync(path, source)
}
const lines = ["## Dataset18 cleanup strategy experiments", "", "All strategies use 2x effort, 1200s per sample, 8 workers, and unchanged initial routing. Timing is summed per-board runtime, not job wall time.", "", "| Strategy | Solved | DRC passing | Timeouts | Vias (passing only) | Runtime (s) |", "| --- | --- | --- | --- | --- | --- |"]
for (const { name, report } of runs) {
  const passing = report.tests.filter((r) => r.didSolve && r.relaxedDrcPassed)
  lines.push(`| ${name} | ${report.tests.filter((r) => r.didSolve).length}/16 | ${passing.length}/16 | ${report.tests.filter((r) => r.didTimeout).length} | ${passing.reduce((sum, r) => sum + r.viaCount!, 0)} | ${(report.tests.reduce((sum, r) => sum + r.elapsedTimeMs, 0) / 1000).toFixed(1)} |`)
}
writeFileSync("benchmark-effort/comparison.md", lines.join("\n") + "\n")
