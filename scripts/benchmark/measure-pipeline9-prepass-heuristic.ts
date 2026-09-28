import { createHash } from "node:crypto"
import {
  DuplicateCongestedPortSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "./scenarios"

type PrepassCounters = {
  sample: number
  portsEvaluated: number
  queries: number
  allocatedBytes: number
  solves: number
}

type ProblemSetup = ReturnType<TinyHyperGraphSolver["computeProblemSetup"]>
type PortId = Parameters<TinyHyperGraphSolver["computeH"]>[0]
type PrepassSolveResult = ReturnType<DuplicateCongestedPortSolver["solve"]>

// Run each mode in its own process, alternating repeated runs:
// bun scripts/benchmark/measure-pipeline9-prepass-heuristic.ts
// bun scripts/benchmark/measure-pipeline9-prepass-heuristic.ts --lazy
// The fixed workload is SRJ18 samples 1–5, effort 1, in dataset sample order.
// elapsedMs includes counter instrumentation and the duplicate-port prepass,
// excluding upstream Pipeline 9 stages, graph hashing, and main graph routing.
// portsEvaluated counts eager distance-table entries; queries counts computeH
// calls (including repeated ports). allocatedBytes sums heuristic-buffer
// allocations across independent solves; it is neither peak memory nor RSS.
async function main(): Promise<void> {
  const args: string[] = process.argv.slice(2)
  if (args.some((arg: string): boolean => arg !== "--lazy")) {
    throw new Error("Usage: measure-pipeline9-prepass-heuristic.ts [--lazy]")
  }
  const lazy: boolean = args.includes("--lazy")
  let active: PrepassCounters | undefined
  const originalSetup = TinyHyperGraphSolver.prototype.computeProblemSetup
  const originalH = TinyHyperGraphSolver.prototype.computeH
  const originalSolve = DuplicateCongestedPortSolver.prototype.solve

  // These prototype patches are confined to this experiment CLI and restored
  // on completion or failure. Both modes run with identical instrumentation.
  TinyHyperGraphSolver.prototype.computeProblemSetup = function (
    this: TinyHyperGraphSolver,
  ): ProblemSetup {
    const result: ProblemSetup = originalSetup.call(this)
    if (active) {
      active.solves++
      active.portsEvaluated += result.portHCostToEndOfRoute?.length ?? 0
      active.allocatedBytes += result.portHCostToEndOfRoute?.byteLength ?? 0
    }
    return result
  }

  TinyHyperGraphSolver.prototype.computeH = function (
    this: TinyHyperGraphSolver,
    portId: PortId,
  ): number {
    if (active) active.queries++
    return originalH.call(this, portId)
  }

  DuplicateCongestedPortSolver.prototype.solve = function (
    this: DuplicateCongestedPortSolver,
  ): PrepassSolveResult {
    const counters: PrepassCounters | undefined = active
    if (!counters) {
      throw new Error(
        "Duplicate-port prepass started outside a measured sample",
      )
    }
    this.options.routeSolveOptions = {
      ...this.options.routeSolveOptions,
      USE_LAZY_ROUTE_HEURISTIC: lazy,
    }
    try {
      const start: number = performance.now()
      const result: PrepassSolveResult = originalSolve.call(this)
      const elapsedMs: number = performance.now() - start
      if (this.failed || !this.solved) {
        throw new Error(
          `Sample ${counters.sample} prepass did not solve: ${this.error}`,
        )
      }
      const hash: string = createHash("sha256")
        .update(
          JSON.stringify({ graph: this.getOutput(), report: this.report }),
        )
        .digest("hex")
      console.log(JSON.stringify({ ...counters, lazy, elapsedMs, hash }))
      return result
    } finally {
      active = undefined
    }
  }

  try {
    for (const sample of [1, 2, 3, 4, 5]) {
      const input = await loadScenarioBySampleNumber("srj18", sample, 1)
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        input.scenario,
        { effort: 1 },
      )
      while (
        !solver.portPointPathingSolver &&
        !solver.failed &&
        !solver.solved
      ) {
        if (solver.getCurrentPhase() === "portPointPathingSolver") {
          active = {
            sample,
            portsEvaluated: 0,
            queries: 0,
            allocatedBytes: 0,
            solves: 0,
          }
        }
        solver.step()
      }
      if (!solver.portPointPathingSolver) {
        throw new Error(
          `Sample ${sample} did not reach port-point pathing: ${solver.error}`,
        )
      }
    }
  } finally {
    active = undefined
    TinyHyperGraphSolver.prototype.computeProblemSetup = originalSetup
    TinyHyperGraphSolver.prototype.computeH = originalH
    DuplicateCongestedPortSolver.prototype.solve = originalSolve
  }
}

try {
  await main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
}
