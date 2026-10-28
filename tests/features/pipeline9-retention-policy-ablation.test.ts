import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getTinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import type {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

test("best-partial retention can be isolated from sharing without changing native budgets or default routing", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      { name: "tree", pointsToConnect: [
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
  for (const usePhysicalNetForest of [false, true]) {
    const observations = [undefined, false, true].map((retainBestPartialRouting) => {
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
        usePhysicalNetForest,
        retainBestPartialRouting,
        cacheProvider: null,
        effort: 1,
      })
      solver.solveUntilPhase("highDensityRouteSolver")
      expect(solver.failed, solver.error ?? "").toBe(false)
      expect(solver.physicalNetForestSolver!.branches).toHaveLength(usePhysicalNetForest ? 2 : 0)
      const pathing = solver.portPointPathingSolver!
      const pipeline = (pathing as unknown as {
        tinyPipelineSolver: TinyHyperGraphSectionPipelineSolver
      }).tinyPipelineSolver
      const tiny = pipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
      expect(tiny.solved).toBe(true)
      expect(tiny.failed).toBe(false)
      expect(tiny.problem.routeCount).toBe(usePhysicalNetForest ? 1 : 3)
      expect(tiny.RETAIN_BEST_PARTIAL_ROUTING).toBe(retainBestPartialRouting ?? usePhysicalNetForest)
      expect(tiny.MAX_ITERATIONS).toBe(2_000_000)
      expect(tiny.GREEDY_FINAL_ROUTE_ITERS).toBe(4)
      expect(tiny.state.unroutedRoutes).toEqual([])
      expect(tiny.stats.retainedPartialRouteCount).toBeUndefined()
      for (let port = 0; port < tiny.topology.portCount; port++) {
        const allowedNet = tiny.problem.portNetId?.[port] ?? -1
        const assignedNet = tiny.state.portAssignment[port]!
        if (allowedNet !== -1 && assignedNet !== -1) expect(assignedNet).toBe(allowedNet)
      }
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
  }
})
