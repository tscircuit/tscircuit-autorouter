import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

class TestPipeline9HighDensitySolver extends Pipeline9HighDensitySolver {
  finishRegularNode(): void {
    this.finishActiveNode([])
  }
}

test("Pipeline9 aggregates grow/shrink attempts from regular node solvers", () => {
  const connMap = new ConnectivityMap({})
  const solver = new TestPipeline9HighDensitySolver({
    nodePortPoints: [],
    fixedHdRoutes: [],
    connMap,
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.5,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
  })
  const regularSolver = new HighDensitySolver({
    nodePortPoints: [],
    connMap,
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })
  regularSolver.stats.highDensityResizeCount = 3
  solver.activeRegularSolver = regularSolver

  solver.finishRegularNode()

  expect(solver.stats.highDensityResizeCount).toBe(3)

  const regionalSolver = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "regional-node",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [],
      portPointsInPairs: [],
    },
    colorMap: {},
    connMap,
    viaDiameter: 0.5,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
  })
  regionalSolver.highDensitySolver.stats.highDensityResizeCount = 2
  regionalSolver.failed = true
  solver.activeFallbackSolver = regionalSolver

  solver.step()

  expect(solver.stats.highDensityResizeCount).toBe(5)
})
