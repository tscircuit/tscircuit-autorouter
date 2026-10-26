import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createModelNode } from "./nativeCostHeuristicTestUtils"
import { priorityParams } from "./priorityDagTestUtils"

test("Pipeline9 enables the analytic Native priority while legacy callers keep their original default", (): void => {
  const params = priorityParams()
  const regular = createPipeline9RegularNodeSolver({
    ...params,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: new Map(),
    obstacles: [],
    layerCount: 2,
  })
  regular.step()
  expect(regular.activeSubSolver).toBeInstanceOf(
    GrowShrinkHighDensityIntraNodeSolver,
  )
  if (!(regular.activeSubSolver instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error("Expected the regular Pipeline9 grow/shrink candidate")
  }
  const portfolio = new PortfolioSingleIntraNodeSolver(
    regular.activeSubSolver.getConstructorParams(),
  )
  for (const candidateParameters of [
    { MISALIGNED_DIST_PENALTY_FACTOR: 5 },
    { MISALIGNED_DIST_PENALTY_FACTOR: 5, PRIORITY_DAG_FAMILY_SIZE: 6 },
  ]) {
    const candidate = portfolio.generateSolver(candidateParameters)
    expect(candidate.hyperParameters.COST_ALIGNED_HEURISTIC).toBe(true)
  }

  const legacy = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "legacy",
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
    A: { x: 0, y: 0, z: 0 },
    B: { x: 2, y: 2, z: 1 },
    minDistBetweenEnteringPoints: 0.05,
    obstacleRoutes: [],
    futureConnections: [
      { connectionName: "future", points: [{ x: 0.4, y: 0.4, z: 0 }] },
    ],
  })
  const node = createModelNode({ x: 0.4, y: 0.4, z: 0 })
  expect(legacy.COST_ALIGNED_HEURISTIC).toBe(false)
  expect(legacy.GREEDY_MULTIPLER).toBe(1.1)
  expect(legacy.computeH(node)).toBe(
    distance(node, legacy.B) ** 1.6 +
      legacy.viaPenaltyDistance +
      legacy.getFutureConnectionPenalty(node, true),
  )
})
