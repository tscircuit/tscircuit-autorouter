import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import type { SimpleRouteJson } from "lib/types"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("no-runtime async stops and outer wrapper budget failures publish exact owned child snapshots", async (): Promise<void> => {
  type Harness = { tinyPipelineSolver: { solveGraph?: IncrementalPreparedPortPointRoutingSolver; activeSubSolver?: IncrementalPreparedPortPointRoutingSolver }; updateIncrementalStats(force?: boolean): void }
  const make = (): { wrapper: TinyHypergraphPortPointPathingSolver; engine: IncrementalPreparedPortPointRoutingSolver } => {
    const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, obstacles: [], connections: [] }
    const p = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null, experimentIncrementalPath: true })
    p.capacityNodes = []; p.srjWithPointPairs = srj; p.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = []
    const stage = p.pipelineDef.find((s) => s.solverName === "portPointPathingSolver")!
    const wrapper = new TinyHypergraphPortPointPathingSolver(stage.getConstructorParams(p)[0] as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0])
    const x = createIncrementalPathToy()
    x.problem.routeMetadata = Array.from({ length: x.problem.routeCount }, (_, i) => ({ mutuallyConnectedNetworkId: `net${i}` }))
    const engine = new IncrementalPreparedPortPointRoutingSolver(x.topology, x.problem, { MAX_ITERATIONS: 100_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false })
    engine.solve(); expect(engine.solved).toBe(true)
    engine.resetRoutingStateForRerip(); engine.solved = false; engine.failed = false; engine.error = null
    const h = wrapper as unknown as Harness
    h.tinyPipelineSolver.solveGraph = engine; h.tinyPipelineSolver.activeSubSolver = engine
    h.updateIncrementalStats()
    expect(wrapper.incrementalPath!.queryStarts).toBe(1)
    expect(wrapper.incrementalPath!.generatedTransitions).toBe(0)
    return { wrapper, engine }
  }
  const asynchronous = make()
  await asynchronous.wrapper.solveAsync(undefined, 2)
  expect(asynchronous.wrapper.iterations).toBe(2)
  expect(asynchronous.engine.incrementalPath.generatedTransitions).toBe(11)
  expect(asynchronous.engine.incrementalPath.queryStarts).toBe(2)
  expect(asynchronous.wrapper.incrementalPath).toEqual(asynchronous.engine.incrementalPath)
  expect(asynchronous.wrapper.incrementalPathScope).toEqual(asynchronous.engine.incrementalPathScope)
  const capped = make()
  capped.wrapper.MAX_ITERATIONS = 1
  capped.wrapper.solve()
  expect(capped.wrapper.failed).toBe(true)
  expect(capped.wrapper.iterations).toBe(2)
  expect(capped.wrapper.error).toContain("ran out of iterations")
  expect(capped.engine.incrementalPath.generatedTransitions).toBe(11)
  expect(capped.engine.incrementalPath.queryStarts).toBe(2)
  expect(capped.wrapper.incrementalPath).toEqual(capped.engine.incrementalPath)
  expect(capped.wrapper.incrementalPathScope).toEqual(capped.engine.incrementalPathScope)
})
