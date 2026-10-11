import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelMultiHeadHighDensityNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiHeadHighDensityNodeSolver"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("a cancelled competing owner releases its worker even while an admitted physical history is pending", async (): Promise<void> => {
  const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const combinations = spyOn(PortfolioSingleIntraNodeSolver.prototype, "getCombinationDefs").mockReturnValue([
    ["multiHeadPolyLine"],
  ])
  const unusedRejections: Array<(error: Error) => void> = []
  let requests = 0
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => {
    requests++
    setTimeout(() => Atomics.store(cancellation, 0, 1), 0)
    return new Map(jobs.map((job) => [job.candidateId, new Promise<MultiHeadHistoryResult>((_, reject) => {
      unusedRejections.push(reject)
    })]))
  }
  const params = { nodePortPoints: [createFirstValidNode()], fixedHdRoutes: [],
    connMap: new ConnectivityMap({ signal_root: ["signal", "signal_root"] }), colorMap: {},
    nodePfById: {}, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15,
    effort: 1, layerCount: 2, obstacles: [], allowBlindAndBuriedVias: false,
    preserveTerminalPcbPortIds: true, includeBoardObstacles: true, enableRegionalFallback: false }
  try {
    const solver = new ParallelMultiHeadHighDensityNodeSolver(params, dispatcher, "first-valid",
      undefined, 0.1, undefined, cancellation.buffer as SharedArrayBuffer)
    await solver.solveAsync()
    expect(requests).toBe(1)
    expect(unusedRejections).toHaveLength(2)
    expect(solver.wasCancelled).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    expect(solver.routes).toEqual([])
    expect(solver.firstValidStats.acceptedCandidateCount).toBe(0)
    for (const reject of unusedRejections) reject(new RangeError("cancelled unused history"))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(solver.wasCancelled).toBe(true)
    expect(solver.failed).toBe(false)
    const preCancelled = new ParallelMultiHeadHighDensityNodeSolver(params, dispatcher, "first-valid",
      undefined, 0.1, undefined, cancellation.buffer as SharedArrayBuffer)
    await preCancelled.solveAsync()
    expect(preCancelled.wasCancelled).toBe(true)
    expect(preCancelled.iterations).toBe(0)
    expect(requests).toBe(1)
  } finally {
    combinations.mockRestore()
  }
})
