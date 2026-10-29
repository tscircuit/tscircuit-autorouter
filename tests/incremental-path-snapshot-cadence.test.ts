import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import type { SimpleRouteJson } from "lib/types"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("actual instance snapshots lag at most511steps and force exact new-instance, terminal, portfolio and async-stop evidence", async (): Promise<void> => {
  type StageHarness = { solveGraph?: IncrementalPreparedPortPointRoutingSolver; activeSubSolver?: IncrementalPreparedPortPointRoutingSolver }
  type WrapperHarness = { tinyPipelineSolver: StageHarness; primaryTinyPipelineSolver?: StageHarness; alternativeTinyPipelineSolver?: StageHarness; incrementalStatsAtIteration: number; updateIncrementalStats(force?: boolean): void }
  const makeWrapper = (): TinyHypergraphPortPointPathingSolver => {
    const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, obstacles: [], connections: [] }
    const p = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null, experimentIncrementalPath: true })
    p.capacityNodes = []; p.srjWithPointPairs = srj; p.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = []
    const stage = p.pipelineDef.find((x) => x.solverName === "portPointPathingSolver")!
    return new TinyHypergraphPortPointPathingSolver(stage.getConstructorParams(p)[0] as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0])
  }
  const makeEngine = (): IncrementalPreparedPortPointRoutingSolver => {
    const x = createIncrementalPathToy()
    return new IncrementalPreparedPortPointRoutingSolver(x.topology, x.problem, { MAX_ITERATIONS: 100_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false })
  }
  const wrapper = makeWrapper(), h = wrapper as unknown as WrapperHarness, engine = makeEngine()
  h.tinyPipelineSolver.solveGraph = engine
  h.updateIncrementalStats()
  expect(wrapper.incrementalPathScope!.solverInstances).toBe(1)
  expect(wrapper.incrementalPath!.queryStarts).toBe(0)
  engine.solve(); expect(engine.solved).toBe(true)
  for (let step = 1; step < 512; step++) {
    wrapper.iterations = step; h.updateIncrementalStats()
    expect(wrapper.incrementalPath!.queryStarts).toBe(0)
  }
  wrapper.iterations = 512; h.updateIncrementalStats()
  expect(wrapper.incrementalPath!.queryStarts).toBe(engine.incrementalPath.queryStarts)
  engine.resetRoutingStateForRerip(); engine.solved = false; engine.failed = false; engine.error = null; engine.solve()
  wrapper.iterations = 513; h.updateIncrementalStats()
  expect(wrapper.incrementalPath!.activated).toBe(0)
  wrapper.solved = true; h.updateIncrementalStats()
  expect(wrapper.incrementalPath).toEqual(engine.incrementalPath)
  wrapper.solved = false
  const second = makeWrapper(), secondH = second as unknown as WrapperHarness, secondEngine = makeEngine()
  secondH.tinyPipelineSolver.solveGraph = secondEngine; h.alternativeTinyPipelineSolver = secondH.tinyPipelineSolver
  h.updateIncrementalStats()
  expect(wrapper.incrementalPathScope!.solverInstances).toBe(2)
  secondEngine.solve(); h.updateIncrementalStats(true)
  expect(wrapper.incrementalPath!.queryStarts).toBe(engine.incrementalPath.queryStarts + secondEngine.incrementalPath.queryStarts)
  h.alternativeTinyPipelineSolver = undefined; h.updateIncrementalStats(true)
  expect(wrapper.incrementalPathScope!.solverInstances).toBe(2)
  const sliced = makeWrapper(), slicedH = sliced as unknown as WrapperHarness, slicedEngine = makeEngine()
  slicedEngine.solve(); slicedEngine.resetRoutingStateForRerip(); slicedEngine.solved = false; slicedEngine.failed = false; slicedEngine.error = null
  slicedH.tinyPipelineSolver.solveGraph = slicedEngine; slicedH.tinyPipelineSolver.activeSubSolver = slicedEngine
  slicedH.updateIncrementalStats()
  const runtime = { executeAsync: async (Solver: new (input: unknown) => { solve(): void; getOutput(): unknown }, input: unknown): Promise<unknown> => { const task = new Solver(input); task.solve(); return task.getOutput() } } as unknown as SolverRuntimeExecutor
  await sliced.solveAsync(runtime, 2)
  expect(sliced.iterations).toBe(2)
  expect(slicedEngine.incrementalPath.chargedWork).toBe(1)
  expect(sliced.incrementalPath).toEqual(slicedEngine.incrementalPath)
  expect(Object.keys(sliced.incrementalPath!)).toHaveLength(16)
  expect(Object.keys(sliced.incrementalPathScope!)).toHaveLength(14)
})
