import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import {
  TinyHyperGraphSolver,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { runTask } from "../scripts/benchmark/benchmark-run-task"
import { logCapturedPathingDiagnostics } from "../scripts/benchmark"
import { observeTinyFinalCompletion } from "../scripts/benchmark/observeTinyFinalCompletion"

test("opt-in Tiny completion observation forwards state and restores the prototype", async (): Promise<void> => {
  const topology: TinyHyperGraphTopology = {
    regionCount: 1,
    portCount: 6,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5]],
    incidentPortRegion: Array.from({ length: 6 }, () => [0]),
    regionWidth: new Float64Array([10]),
    regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portX: new Float64Array([5, 5, 5, 5, -5, -5]),
    portY: new Float64Array([-4, -3, 1, 2, 1, -1]),
    portZ: new Int32Array(6),
    portAngleForRegion1: new Int32Array([900, 1800, 5400, 6300, 21600, 23400]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 2, 4]),
    routeEndPort: new Int32Array([1, 3, 5]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1]),
    initialAssignments: [{ routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 }],
    routeMetadata: [{ connectionId: "seed" }, { connectionId: "π\ncompleted" }, { connectionId: "remaining" }],
  }
  class CompletionProbe extends SelectiveReripTinyHyperGraphSolver {
    protected override createGreedyFinalRouteSolver(
      options: TinyHyperGraphSolverOptions,
      attempt: number,
    ): TinyHyperGraphSolver {
      const candidate = super.createGreedyFinalRouteSolver(options, attempt)
      const originalSolve = candidate.solve
      candidate.solve = (): void => {
        if (attempt < 0) {
          while (candidate.state.currentRouteId === 1 || candidate.state.unroutedRoutes.includes(1)) {
            if (candidate.failed || candidate.iterations > 100) throw new Error("Tiny fixture did not complete route1")
            candidate.step()
          }
          candidate.failed = true
          candidate.error = "cost-aware fixture boundary"
        } else if (attempt === 0) {
          candidate.failed = true
          candidate.error = "greedy fixture boundary"
        } else {
          originalSolve.call(candidate)
        }
      }
      return candidate
    }
  }
  type Prototype = { getRemainingRouteIdsForGreedyFinalRoute: () => number[] }
  const prototype = TinyHyperGraphSolver.prototype as unknown as Prototype
  const original = prototype.getRemainingRouteIdsForGreedyFinalRoute
  const observer = observeTinyFinalCompletion()
  try {
    const solver = new CompletionProbe(topology, problem, {
      MAX_ITERATIONS: 2_000_000,
      GREEDY_FINAL_ROUTE_ITERS: 4,
      STATIC_REACHABILITY_PRECHECK: false,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    })
    solver.tryFinalAcceptance()
    expect(solver.solved).toBe(true)
    expect(observer.events.map((event) => event.solverClass)).toEqual([
      "CompletionProbe", "CongestionAwareFinalRouteSolver", "GreedyFinalRouteSolver",
    ])
    expect(observer.events.map((event) => event.remainingRouteIds)).toEqual([[1, 2], [2], [2]])
    expect(observer.events[0].remainingConnectionIds).toEqual(["π\ncompleted", "remaining"])
    expect(observer.events.map((event) => event.maximumIterations)).toEqual([2_000_000, 4_000_000, 50_000])
    expect(observer.events[1].error).toBe("cost-aware fixture boundary")
    expect(observer.events[2].error).toBe("greedy fixture boundary")
    const recorded = JSON.stringify(observer.events)
    solver.state.unroutedRoutes.push(99)
    solver.stats.neverSuccessfullyRoutedRouteCount = 99
    expect(JSON.stringify(observer.events)).toBe(recorded)
  } finally {
    observer.restore()
  }
  expect(prototype.getRemainingRouteIdsForGreedyFinalRoute).toBe(original)

  const returned = [1, 2]
  let forwarded = 0
  prototype.getRemainingRouteIdsForGreedyFinalRoute = function (): number[] {
    forwarded += 1
    return returned
  }
  const forwardingObserver = observeTinyFinalCompletion()
  try {
    const solver = new TinyHyperGraphSolver(topology, problem)
    const actual = (solver as unknown as Prototype).getRemainingRouteIdsForGreedyFinalRoute()
    expect(actual).toBe(returned)
    expect(forwarded).toBe(1)
    returned.push(99)
    expect(forwardingObserver.events[0].remainingRouteIds).toEqual([1, 2])
  } finally {
    forwardingObserver.restore()
    prototype.getRemainingRouteIdsForGreedyFinalRoute = original
  }

  const task = {
    datasetName: "unit-test",
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "forced-failure",
    sampleNumber: 1,
    scenario: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, obstacles: [], connections: [] },
  }
  const pipeline = AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype
  const originalSolve = pipeline.solveAsync
  let expectedObserver = false
  pipeline.solveAsync = async function (): Promise<void> {
    expect(prototype.getRemainingRouteIdsForGreedyFinalRoute !== original).toBe(expectedObserver)
    throw new Error("intentional solve failure")
  }
  try {
    const normal = await runTask(task)
    expect(Object.hasOwn(normal, "pathingDiagnostics")).toBe(false)
    expectedObserver = true
    const captured = await runTask({ ...task, captureFinalSrj: true })
    expect(captured.didSolve).toBe(false)
    expect(captured.error).toContain("intentional solve failure")
    expect(captured.pathingDiagnostics).toEqual({ datasetName: "unit-test", events: [] })
    expect(prototype.getRemainingRouteIdsForGreedyFinalRoute).toBe(original)
    await expect(runTask({ ...task, solverName: "missing-solver", captureFinalSrj: true })).rejects.toThrow()
    expect(prototype.getRemainingRouteIdsForGreedyFinalRoute).toBe(original)
    const lines: string[] = []
    logCapturedPathingDiagnostics([normal], (line) => lines.push(line))
    expect(lines).toEqual([])
    const loggedEvents = [{
      ...observer.events[0],
      remainingRouteCount: 1200,
      remainingRouteIds: Array.from({ length: 1200 }, (_, index) => index),
      remainingConnectionIds: Array.from({ length: 1200 }, (_, index) =>
        `${createHash("sha256").update(String(index)).digest("hex")} π\nline`,
      ),
    }]
    logCapturedPathingDiagnostics([{ ...captured, pathingDiagnostics: { datasetName: "unit-test", events: loggedEvents }, routingMetrics: { highDensityIterations: 17 } }], (line) => lines.push(line))
    const begin = JSON.parse(lines[0].replace("BENCHMARK_PATHING_DIAGNOSTICS_BEGIN ", ""))
    expect(begin.chunkCount).toBeGreaterThan(1)
    const chunks = lines.slice(1, -1).map((line, index) => {
      const match = line.match(/^BENCHMARK_PATHING_DIAGNOSTICS_CHUNK 0 (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/)!
      expect(Number(match[1])).toBe(index + 1)
      expect(Number(match[2])).toBe(begin.chunkCount)
      return match[3]
    })
    const compressed = Buffer.from(chunks.join(""), "base64")
    const raw = gunzipSync(compressed)
    expect(compressed.length).toBe(begin.gzipBytes)
    expect(raw.length).toBe(begin.rawBytes)
    expect(createHash("sha256").update(raw).digest("hex")).toBe(begin.sha256)
    const recovered = JSON.parse(raw.toString("utf8"))
    expect(recovered.pathingDiagnostics.events).toEqual(loggedEvents)
    expect(recovered.routingMetrics).toEqual({ highDensityIterations: 17 })
    expect(recovered.error).toContain("intentional solve failure")
    expect(Object.hasOwn(recovered, "finalSrj")).toBe(false)
    expect(Object.hasOwn(recovered, "benchmarkSnapshot")).toBe(false)
    expect(lines.every((line) => line.length <= 4096)).toBe(true)
    expect(JSON.parse(lines.at(-1)!.replace("BENCHMARK_PATHING_DIAGNOSTICS_END ", ""))).toEqual({ captureIndex: 0, sha256: begin.sha256 })
  } finally {
    pipeline.solveAsync = originalSolve
  }
})
