import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import { ParallelMultiHeadHighDensityNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiHeadHighDensityNodeSolver"
import type { MultiHeadHistoryDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createFirstValidNode, createFirstValidRoute, FirstValidGenericSolver } from "tests/fixtures/first-valid-hd-fixtures"

test("competitive node drivers yield macrotasks while the original generic chunks continue", async (): Promise<void> => {
  const originalDefs = PortfolioSingleIntraNodeSolver.prototype.getHyperParameterDefs()
  const defs = spyOn(PortfolioSingleIntraNodeSolver.prototype, "getHyperParameterDefs").mockReturnValue([
    ...originalDefs, { name: "testGeneric", possibleValues: [{ TEST_GENERIC: true }] } as unknown as typeof originalDefs[number],
  ])
  const combinations = spyOn(PortfolioSingleIntraNodeSolver.prototype, "getCombinationDefs").mockReturnValue([
    ["testGeneric"], ["multiHeadPolyLine"],
  ])
  const originalGenerate = PortfolioSingleIntraNodeSolver.prototype.generateSolver
  let generic: FirstValidGenericSolver | undefined
  const generate = spyOn(PortfolioSingleIntraNodeSolver.prototype, "generateSolver").mockImplementation(function (this: PortfolioSingleIntraNodeSolver, hyperParameters): IntraNodeRouteSolver {
    if (!hyperParameters.TEST_GENERIC) return originalGenerate.call(this, hyperParameters)
    generic = new FirstValidGenericSolver([
      createFirstValidRoute(this.nodeWithPortPoints, this.constructorParams.traceWidth ?? 0.15),
    ])
    return generic as unknown as IntraNodeRouteSolver
  })
  let clock = 0
  const now = spyOn(performance, "now").mockImplementation(() => { clock += 100; return clock })
  let delivered = 0
  let cancellations = 0
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => new Map(jobs.map((job) => [
    job.candidateId, new Promise((resolve) => setTimeout(() => {
      delivered++
      resolve(executeMultiHeadHistoryJob(job))
    }, 0)),
  ]))
  try {
    const node = createFirstValidNode()
    const solver = new ParallelMultiHeadHighDensityNodeSolver({ nodePortPoints: [node], fixedHdRoutes: [],
      connMap: new ConnectivityMap({ signal_root: ["signal", "signal_root"] }), colorMap: {},
      nodePfById: {}, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15,
      effort: 1, layerCount: 2, obstacles: [], allowBlindAndBuriedVias: false,
      preserveTerminalPcbPortIds: true, includeBoardObstacles: true, enableRegionalFallback: false,
    }, dispatcher, "first-valid", (): void => { cancellations++ })
    await solver.solveAsync()
    expect(delivered).toBe(2)
    expect(generic?.iterations).toBe(100)
    expect(generic?.solved).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.routes).toHaveLength(1)
    expect(solver.routes[0]?.rootConnectionName).toBe("signal_root")
    expect(solver.firstValidStats.acceptedCandidateCount).toBe(1)
    expect(solver.firstValidStats.rejectedCandidateCount).toBe(0)
    expect(cancellations).toBe(1)
  } finally {
    defs.mockRestore()
    combinations.mockRestore()
    generate.mockRestore()
    now.mockRestore()
  }
})
