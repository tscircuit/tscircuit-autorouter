import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const makeParams = (
  padHeight: number,
  effort: number,
): ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] => {
  const routes: HighDensityRoute[] = Array.from({ length: 480 }, (_, i) => ({
    connectionName: `signal_${i}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: i * 2, z: 0 },
      { x: 1, y: i * 2, z: 0 },
    ],
    vias: [],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -3, maxX: 2, maxY: 960 },
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point, i) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pcb_port_id: `pcb_port_${route.connectionName}_${i}`,
      })),
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 20 },
        width: 0.2,
        height: padHeight,
        layers: ["top"],
        connectedTo: ["foreign_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
      },
    ],
  }
  return {
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort,
    colorMap: {},
  }
}

test("large conflicted boards bound repair work while near-clean and higher-effort boards retain the full budget", (): void => {
  expect(getPipeline9BoundedRepairBudget(480, 20, 1)).toEqual({
    maxRegions: 8,
    maxCandidateAttempts: 256,
    maxPathSearchNodes: 2500000,
    maxPathSearchNodesPerCall: 500000,
    pathHeuristicWeight: 2,
    revisitChangedRegions: true,
  })
  for (const [routeCount, errors, effort] of [
    [480, 9, 1],
    [120, 20, 1],
  ]) {
    expect(
      getPipeline9BoundedRepairBudget(routeCount!, errors!, effort!),
    ).toEqual({
      maxRegions: 4,
      maxCandidateAttempts: 1024,
      maxPathSearchNodes: 480000,
    })
  }
  expect(getPipeline9BoundedRepairBudget(480, 20, 4)).toEqual({
    maxRegions: 8,
    maxCandidateAttempts: 1024,
    maxPathSearchNodes: 10000000,
    maxPathSearchNodesPerCall: 500000,
    pathHeuristicWeight: 2,
    revisitChangedRegions: true,
  })
  expect(getPipeline9BoundedRepairBudget(480, 121, 1).pathHeuristicWeight).toBe(
    4,
  )
  const conflicted = new Pipeline9JointDrcRepairSolver(makeParams(40, 1))
  expect(conflicted.stats.initialJointDrcIssueCount).toBeGreaterThanOrEqual(20)
  expect(conflicted.exactRepairSolver!.params.maxIterations).toBe(8)
  expect(conflicted.exactRepairSolver!.params.broadMaxIterations).toBe(4)
  expect(conflicted.exactRepairSolver!.params.broadPassMultiplier).toBe(0.75)

  const heavilyConflicted = new Pipeline9JointDrcRepairSolver(
    makeParams(800, 1),
  )
  expect(
    heavilyConflicted.stats.initialJointDrcIssueCount,
  ).toBeGreaterThanOrEqual(200)
  expect(heavilyConflicted.exactRepairSolver!.params.maxIterations).toBe(2)
  expect(heavilyConflicted.exactRepairSolver!.params.broadMaxIterations).toBe(1)
  expect(heavilyConflicted.exactRepairSolver!.params.broadPassMultiplier).toBe(
    0.1875,
  )

  const nearClean = new Pipeline9JointDrcRepairSolver(makeParams(0.2, 1))
  expect(nearClean.stats.initialJointDrcIssueCount).toBe(1)
  expect(nearClean.exactRepairSolver!.params.maxIterations).toBe(32)

  const higherEffort = new Pipeline9JointDrcRepairSolver(makeParams(800, 4))
  expect(higherEffort.exactRepairSolver!.params.maxIterations).toBe(32)
  expect(higherEffort.exactRepairSolver!.params.broadMaxIterations).toBe(12)
  expect(higherEffort.exactRepairSolver!.params.broadPassMultiplier).toBe(3)
})
