import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("owned Pipeline9 defaults to checked contact refinement while the projected network factory stays unchanged", (): void => {
  const { node } = createPolylineContactFixture()
  const diagnostics: Record<string, number> = {}
  for (const local of [true, false]) {
    const regular = createPipeline9RegularNodeSolver({
      nodeWithPortPoints: node, connMap: new ConnectivityMap({}), colorMap: {},
      traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1,
      obstacles: [], layerCount: 2, effort: 1, nodePfById: {},
      priorityDagSearch: local, priorityDiagnostics: diagnostics,
    })
    regular.step()
    const grow = regular.activeSubSolver
    if (!(grow instanceof GrowShrinkHighDensityIntraNodeSolver)) throw new Error("Missing production grow/shrink adapter")
    const portfolio = new PortfolioSingleIntraNodeSolver(grow.constructorParams)
    const candidate = portfolio.generateSolver({ MULTI_HEAD_POLYLINE_SOLVER: true, SEGMENTS_PER_POLYLINE: 3 })
    expect(candidate instanceof MultiHeadPolylineContactSolver).toBe(local)
    expect(candidate instanceof MultiHeadPolyLineIntraNodeSolver3).toBe(true)
    expect(candidate.MAX_ITERATIONS).toBe(1000)
    if (candidate instanceof MultiHeadPolylineContactSolver) {
      candidate.solve()
      expect(candidate.error).toBeNull()
      expect(candidate.solved).toBe(true)
      expect(candidate.solvedRoutes).toHaveLength(2)
      expect(candidate.stats.contactInheritedSeedSetups).toBe(1)
      expect(candidate.stats.contactRetainedSeeds).toBeGreaterThan(0)
      expect(candidate.stats.contactValidatedSolutions).toBe(1)
    }
  }
  expect(diagnostics.contactInstances).toBeGreaterThan(0)
})
