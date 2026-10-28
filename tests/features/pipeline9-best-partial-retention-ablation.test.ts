import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getTinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import type {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

test("optional best-partial retention reaches the ordinary native caller without changing default work or budgets", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      { name: "three-terminal", pointsToConnect: [
        { x: -2, y: 0, layer: "top", pointId: "a" },
        { x: 0, y: 0, layer: "top", pointId: "b" },
        { x: 2, y: 0, layer: "top", pointId: "c" },
      ] },
      { name: "ordinary", pointsToConnect: [
        { x: -2, y: 2, layer: "top", pointId: "d" },
        { x: 2, y: 2, layer: "top", pointId: "e" },
      ] },
    ],
  }
  const observations = [undefined, false, true].map((retainBestPartialRouting) => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
      retainBestPartialRouting,
      cacheProvider: null,
      effort: 1,
    })
    solver.solveUntilPhase("highDensityRouteSolver")
    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.pipelineDef.some(({ solverName }) => solverName === "physicalNetForestSolver")).toBe(false)
    const pathing = solver.portPointPathingSolver!
    const pipeline = (pathing as unknown as {
      tinyPipelineSolver: TinyHyperGraphSectionPipelineSolver
    }).tinyPipelineSolver
    const tiny = pipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
    expect(tiny.solved).toBe(true)
    expect(tiny.failed).toBe(false)
    expect(tiny.problem.routeCount).toBe(3)
    expect(tiny.RETAIN_BEST_PARTIAL_ROUTING).toBe(retainBestPartialRouting === true)
    expect(tiny.MAX_ITERATIONS).toBe(2_000_000)
    expect(tiny.GREEDY_FINAL_ROUTE_ITERS).toBe(4)
    expect(tiny.state.unroutedRoutes).toEqual([])
    expect(tiny.stats.retainedPartialRouteCount).toBeUndefined()
    const { RETAIN_BEST_PARTIAL_ROUTING, ...unchangedOptions } = getTinyHyperGraphSolverOptions(tiny)
    return {
      unchangedOptions,
      iterations: tiny.iterations,
      stats: tiny.stats,
      assignments: tiny.state.portAssignment,
      segments: tiny.state.regionSegments,
      paths: pathing.getOutput(),
    }
  })
  expect(observations[0]).toEqual(observations[1])
  expect(observations[0]).toEqual(observations[2])
})
